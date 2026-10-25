import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBookingService } from '../hooks/useBookingService';
import { FlightStatusBadge } from './StatusBadge';
import SeatMap from './SeatMap';
import Notice from './Notice';
import { format } from '../domain/money';

const EMPTY_FORM = { fullName: '', email: '', passport: '', phone: '' };

/** Choose an existing passenger, or register a new one on the spot. */
function PassengerPicker({ service, flight, passengerId, setPassengerId, isNew, setIsNew, form, setForm }) {
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <>
      <div className="custom-control custom-checkbox mb-2">
        <input type="checkbox" className="custom-control-input" id="new-passenger"
               checked={isNew} onChange={(e) => setIsNew(e.target.checked)} />
        <label className="custom-control-label" htmlFor="new-passenger">New passenger</label>
      </div>

      {!isNew ? (
        <div className="form-group">
          <label htmlFor="passenger">Passenger</label>
          <select id="passenger" className="form-control" value={passengerId}
                  onChange={(e) => setPassengerId(e.target.value)}>
            <option value="">Select a passenger…</option>
            {service.getAllPassengers().map((p) => {
              const already = service.hasActiveBooking(p, flight);
              return (
                <option key={p.passengerId} value={p.passengerId} disabled={already}>
                  {p.fullName} ({p.passengerId}){already ? ' — already on this flight' : ''}
                </option>
              );
            })}
          </select>
        </div>
      ) : (
        <>
          <div className="form-group">
            <label htmlFor="np-name">Full name</label>
            <input id="np-name" className="form-control" value={form.fullName} onChange={set('fullName')} required />
          </div>
          <div className="form-group">
            <label htmlFor="np-email">Email</label>
            <input id="np-email" type="email" className="form-control" value={form.email} onChange={set('email')} required />
          </div>
          <div className="form-row">
            <div className="form-group col-6">
              <label htmlFor="np-passport">Passport no.</label>
              <input id="np-passport" className="form-control" value={form.passport} onChange={set('passport')} required />
            </div>
            <div className="form-group col-6">
              <label htmlFor="np-phone">Mobile (optional)</label>
              <input id="np-phone" type="tel" className="form-control" value={form.phone} onChange={set('phone')} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** Seat map + booking panel for one flight (route: /book/:flightId). Full flights offer the waitlist. */
export default function BookTicket() {
  const { flightId } = useParams();
  const service = useBookingService();
  const flight = service.getFlight(flightId);

  const [selected, setSelected] = useState(null);
  const [suite, setSuite] = useState(false);
  const [passengerId, setPassengerId] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState(null);

  if (!flight) {
    return (
      <div className="panel">
        <h2>Flight not found</h2>
        <p className="mt-2">There is no flight {flightId}. <Link to="/flights">Back to all flights</Link></p>
      </div>
    );
  }

  const status = service.getFlightStatus(flight);
  const full = !flight.hasAvailability();
  const seat = selected ? flight.getSeat(selected) : null;
  const chosen = seat && !seat.isOccupied ? seat : null;
  const wantsSuite = Boolean(chosen && chosen.supportsPrivateSuite && suite);
  const listPrice = chosen ? service.listPrice(flight, chosen, wantsSuite) : 0;
  const price = chosen ? service.quote(flight, chosen, wantsSuite) : 0;
  const waiting = service.getWaitlist(flight.id);

  /** Returns the id of the passenger to book, registering them first if "New passenger" is ticked. */
  function resolvePassenger() {
    if (!isNew) {
      if (!passengerId) throw new Error('Please choose a passenger.');
      return passengerId;
    }
    const registered = service.registerPassenger(form);
    setIsNew(false);
    setForm(EMPTY_FORM);
    setPassengerId(registered.passengerId);       // kept selected even if the booking below fails
    return registered.passengerId;
  }

  function handleBook(e) {
    e.preventDefault();
    if (!chosen) return;
    try {
      const booking = service.createBooking(resolvePassenger(), flight.id, chosen.seatNumber, wantsSuite);
      setMessage({ type: 'success', title: `Booking ${booking.bookingId} confirmed.`, text: `${booking.getReceipt()} · Reference ${booking.reference}`, link: true });
      setSelected(null);
      setSuite(false);
      setPassengerId('');
    } catch (err) {
      setMessage({ type: 'danger', text: err.message });
    }
  }

  function handleWaitlist(e) {
    e.preventDefault();
    try {
      const booking = service.joinWaitlist(resolvePassenger(), flight.id);
      const place = service.getWaitlistPosition(flight.id, booking.passenger);
      setMessage({
        type: 'success',
        title: `${booking.passenger.fullName} is number ${place} on the waitlist.`,
        text: 'They will be confirmed automatically when a seat is cancelled.',
        link: true,
      });
      setPassengerId('');
    } catch (err) {
      setMessage({ type: 'danger', text: err.message });
    }
  }

  const picker = (
    <PassengerPicker service={service} flight={flight} passengerId={passengerId} setPassengerId={setPassengerId}
                     isNew={isNew} setIsNew={setIsNew} form={form} setForm={setForm} />
  );

  return (
    <>
      <p className="mb-2"><Link to="/flights">← All flights</Link></p>

      <div className="panel">
        <div className="d-flex flex-wrap justify-content-between align-items-center">
          <div>
            <h2>{flight.airline ? `${flight.airline} ` : ''}{flight.flightNumber} · {flight.origin} → {flight.destination}</h2>
            <p className="text-muted mb-0">
              Departs {flight.departureLabel} · Arrives {flight.arrivalLabel}
            </p>
          </div>
          <FlightStatusBadge status={status} />
        </div>
      </div>

      {message && (
        <Notice type={message.type} title={message.title} onClose={() => setMessage(null)}>
          {message.text}
          {message.link && <> <Link to="/bookings">View bookings</Link></>}
        </Notice>
      )}
      {!status.bookable && (
        <Notice type="warning">
          This flight is {status.label.toLowerCase()}, so it is closed for booking. You can still look at the seat map.
        </Notice>
      )}

      <div className="row">
        <div className="col-lg-7">
          <div className="panel">
            <SeatMap flight={flight} selectedSeat={chosen ? chosen.seatNumber : null}
                     interactive={status.bookable && !full}
                     onSelect={(number) => { setSelected(number); setSuite(false); setMessage(null); }} />
          </div>
        </div>

        <div className="col-lg-5">
          {status.bookable && full && (
            <form className="panel" onSubmit={handleWaitlist}>
              <h4>This flight is full</h4>
              <p className="text-muted">
                Join the waitlist and the first passenger in the queue is given the next seat that is cancelled.
              </p>
              {waiting.length > 0 && (
                <ol className="pl-3">
                  {waiting.map((p) => <li key={p.passengerId}>{p.fullName}</li>)}
                </ol>
              )}
              {picker}
              <button type="submit" className="btn btn-primary btn-block">Join waitlist</button>
            </form>
          )}

          {status.bookable && !full && (
            <form className="panel" onSubmit={handleBook}>
              <h4>Your booking</h4>
              {!chosen ? (
                <p className="text-muted">Choose a seat on the map to see its price.</p>
              ) : (
                <>
                  <dl className="row mb-2">
                    <dt className="col-4">Seat</dt><dd className="col-8">{chosen.seatNumber} · {chosen.seatClass}</dd>
                    <dt className="col-4">Perks</dt><dd className="col-8">{chosen.perks}</dd>
                    <dt className="col-4">Price</dt>
                    <dd className="col-8">
                      {price < listPrice && <span className="price-strike">{format(listPrice)}</span>}
                      <span className="price-now">{format(price)}</span>
                      {price < listPrice && <div><span className="badge badge-success">Early bird −10%</span></div>}
                    </dd>
                  </dl>
                  {chosen.supportsPrivateSuite && (
                    <div className="custom-control custom-checkbox mb-3">
                      <input type="checkbox" className="custom-control-input" id="suite"
                             checked={suite} onChange={(e) => setSuite(e.target.checked)} />
                      <label className="custom-control-label" htmlFor="suite">Private suite (+£200)</label>
                    </div>
                  )}
                  {picker}
                  <button type="submit" className="btn btn-primary btn-block">
                    Confirm booking · {format(price)}
                  </button>
                </>
              )}
            </form>
          )}
        </div>
      </div>
    </>
  );
}

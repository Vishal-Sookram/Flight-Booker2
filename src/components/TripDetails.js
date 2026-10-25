import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useBookingService } from '../hooks/useBookingService';
import { BookingStatusBadge } from './StatusBadge';
import FlightLine from './FlightLine';
import Notice from './Notice';
import { format } from '../domain/money';
import { normaliseReference } from '../domain/reference';

/**
 * Everything bought under one booking reference (route: /trip/:reference): the itinerary, who sits where and what was
 * paid. It prints cleanly as an e-ticket, and the whole trip can be cancelled from here.
 */
export default function TripDetails() {
  const { reference } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const service = useBookingService();
  const [message, setMessage] = useState(null);
  const [lookup, setLookup] = useState('');
  // The payment summary arrives in the navigation state. Keep it for this visit only: the browser would otherwise
  // restore it (and the "thank you" banner) on every refresh.
  const [paid] = useState(() => (location.state && location.state.paid) || null);
  useEffect(() => {
    if (location.state && location.state.paid) navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate]);

  const trip = service.getReservation(reference);

  if (!trip) {
    return (
      <div className="panel">
        <h2>No booking found</h2>
        <p className="mt-2">There is no booking with reference <strong>{normaliseReference(reference)}</strong>. Check the code and try again.</p>
        <form className="form-inline" onSubmit={(e) => { e.preventDefault(); if (normaliseReference(lookup)) navigate(`/trip/${normaliseReference(lookup)}`); }}>
          <input className="form-control mr-2" aria-label="Booking reference" placeholder="Reference" value={lookup} onChange={(e) => setLookup(e.target.value)} />
          <button type="submit" className="btn btn-primary">Find booking</button>
        </form>
      </div>
    );
  }

  function handleCancel() {
    const active = trip.bookings.filter((b) => b.isActive).length;
    if (!window.confirm(`Cancel ${active} booking${active > 1 ? 's' : ''} under reference ${trip.reference}?`)) return;
    const outcome = service.cancelReservation(trip.reference);
    if (outcome.failed.length > 0) {
      setMessage({ type: 'warning', text: `Cancelled ${outcome.cancelled.length}, but ${outcome.failed.length} could not be cancelled: ${outcome.failed[0].reason}` });
    } else {
      setMessage({ type: 'success', text: `Cancelled ${outcome.cancelled.length} booking${outcome.cancelled.length > 1 ? 's' : ''}.` });
    }
  }

  const bookingsOn = (flight) => trip.bookings.filter((b) => b.flight.id === flight.id);

  return (
    <>
      {paid && (
        <div className="alert alert-success no-print" role="status">
          <strong>Thank you - your booking is confirmed.</strong> Paid {format(paid.amount)} with {paid.brand} ending {paid.last4} (demo payment, {paid.transactionId}).
        </div>
      )}
      {message && <Notice type={message.type} onClose={() => setMessage(null)}>{message.text}</Notice>}

      <div className="panel">
        <div className="d-flex flex-wrap justify-content-between align-items-center">
          <div>
            <div className="text-muted small">Booking reference</div>
            <h2 className="reference">{trip.reference}</h2>
          </div>
          <div className="text-right no-print">
            <button type="button" className="btn btn-outline-primary mr-2" onClick={() => window.print()}>Print e-ticket</button>
            {trip.isActive && <button type="button" className="btn btn-outline-danger" onClick={handleCancel}>Cancel trip</button>}
          </div>
        </div>
      </div>

      {trip.flights.map((flight) => (
        <div className="panel" key={flight.id}>
          <FlightLine flight={flight} />
          <table className="table table-sm mt-2 mb-0">
            <thead><tr><th>Passenger</th><th>Seat</th><th>Booking</th><th>Status</th><th className="text-right">Fare</th></tr></thead>
            <tbody>
              {bookingsOn(flight).map((b) => (
                <tr key={b.bookingId}>
                  <td>{b.passenger.fullName}<div className="small text-muted">{b.passenger.passengerId}</div></td>
                  <td>{b.seat ? `${b.seat.seatNumber} · ${b.seat.seatClass}${b.hasPrivateSuite ? ' · suite' : ''}` : '—'}</td>
                  <td>{b.bookingId}</td>
                  <td><BookingStatusBadge status={b.status} /></td>
                  <td className="text-right">{b.status === 'WAITLISTED' ? '—' : format(b.calculateTotal())}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="panel d-flex justify-content-between align-items-center">
        <span>Total fare ({trip.passengers.length} passenger{trip.passengers.length > 1 ? 's' : ''})</span>
        <strong className="price-now">{format(trip.total)}</strong>
      </div>

      <p className="no-print"><Link to="/">Book another flight</Link> · <Link to="/bookings">All bookings</Link></p>
    </>
  );
}

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBookingService } from '../hooks/useBookingService';
import { BookingStatusBadge } from './StatusBadge';
import Notice from './Notice';
import { BookingStatus } from '../domain/booking';
import { FlightStatus } from '../domain/flight';
import { format } from '../domain/money';
import { downloadText } from '../utils';

const STATUS_FILTERS = [
  ['ALL', 'All'],
  [BookingStatus.CONFIRMED, 'Confirmed'],
  [BookingStatus.CHECKED_IN, 'Checked in'],
  [BookingStatus.WAITLISTED, 'Waitlisted'],
  [BookingStatus.CANCELLED, 'Cancelled'],
];

/** List of bookings / tracking screen: every booking with its real status, plus cancel, check-in and receipt. */
export default function ListBooking() {
  const service = useBookingService();
  const [filter, setFilter] = useState({ text: '', status: 'ALL' });
  const [confirmId, setConfirmId] = useState(null);      // booking awaiting "are you sure?"
  const [receiptId, setReceiptId] = useState(null);
  const [message, setMessage] = useState(null);

  const all = service.getAllBookings();
  const text = filter.text.trim().toLowerCase();
  const bookings = all.filter((b) =>
    (filter.status === 'ALL' || b.status === filter.status)
    && (text === '' || [b.bookingId, b.reference ?? '', b.passenger.fullName, b.passenger.passengerId, b.flight.flightNumber]
      .some((v) => v.toLowerCase().includes(text))));
  const countOf = (status) => all.filter((b) => b.status === status).length;

  function run(action) {
    try {
      action();
    } catch (err) {
      setMessage({ type: 'danger', text: err.message });
    }
  }

  const cancel = (booking) => run(() => {
    const { promoted } = service.cancelBooking(booking.bookingId);
    setConfirmId(null);
    setMessage({
      type: 'success',
      text: `Booking ${booking.bookingId} cancelled.` + (promoted
        ? ` ${promoted.passenger.fullName} was moved off the waitlist into seat ${promoted.seat.seatNumber}.`
        : ''),
    });
  });

  const checkIn = (booking) => run(() => {
    service.checkIn(booking.bookingId);
    setMessage({ type: 'success', text: `${booking.passenger.fullName} is checked in for ${booking.flight.flightNumber}.` });
  });

  return (
    <>
      <h2 className="page-title">List of Bookings / Tracking</h2>

      {message && <Notice type={message.type} onClose={() => setMessage(null)}>{message.text}</Notice>}

      <div className="panel">
        <div className="form-row align-items-end">
          <div className="form-group col-md-5">
            <label htmlFor="search">Search</label>
            <input id="search" className="form-control" placeholder="Booking, reference, passenger or flight"
                   value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
          </div>
          <div className="form-group col-md-4">
            <label htmlFor="status">Status</label>
            <select id="status" className="form-control" value={filter.status}
                    onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              {STATUS_FILTERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}{value === 'ALL' ? ` (${all.length})` : ` (${countOf(value)})`}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group col-md-3">
            <button type="button" className="btn btn-outline-primary btn-block" disabled={all.length === 0}
                    onClick={() => downloadText('airnest-bookings.csv', service.exportBookingsCsv())}>
              Export CSV
            </button>
          </div>
        </div>

        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Booking</th><th>Passenger</th><th>Flight</th><th>Departs</th>
                <th>Seat</th><th className="text-right">Fare</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {bookings.length === 0 && (
                <tr><td colSpan="8" className="text-center text-muted">No bookings match.</td></tr>
              )}
              {bookings.map((b) => {
                const flightStatus = service.getFlightStatus(b.flight);
                const canCancel = b.isActive && flightStatus !== FlightStatus.DEPARTED;
                const canCheckIn = b.status === BookingStatus.CONFIRMED
                  && flightStatus !== FlightStatus.DEPARTED && flightStatus !== FlightStatus.CANCELLED;
                const place = b.status === BookingStatus.WAITLISTED
                  ? service.getWaitlistPosition(b.flight.id, b.passenger) : 0;
                return (
                  <React.Fragment key={b.bookingId}>
                    <tr>
                      <td>
                        <strong>{b.bookingId}</strong>
                        {b.reference && <div className="small"><Link to={`/trip/${b.reference}`} title="Open this trip">{b.reference}</Link></div>}
                      </td>
                      <td>
                        {b.passenger.fullName}
                        <div className="small text-muted">{b.passenger.passengerId}{b.passenger.phone ? ` · ${b.passenger.phone}` : ''}</div>
                      </td>
                      <td>{b.flight.flightNumber}<div className="small text-muted">{b.flight.origin} → {b.flight.destination}</div></td>
                      <td>{b.flight.departureLabel}</td>
                      <td>
                        {b.seat
                          ? <>{b.seat.seatNumber}<div className="small text-muted">{b.seat.seatClass}{b.hasPrivateSuite ? ' Suite' : ''}</div></>
                          : <span className="text-muted">{place > 0 ? `Waitlist #${place}` : '—'}</span>}
                      </td>
                      <td className="text-right">{format(b.calculateTotal())}</td>
                      <td><BookingStatusBadge status={b.status} /></td>
                      <td className="text-right text-nowrap">
                        {confirmId === b.bookingId ? (
                          <>
                            <span className="small mr-2">Cancel this booking?</span>
                            <button type="button" className="btn btn-sm btn-danger mr-1" onClick={() => cancel(b)}>Yes</button>
                            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setConfirmId(null)}>No</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn btn-sm btn-outline-secondary mr-1"
                                    onClick={() => setReceiptId(receiptId === b.bookingId ? null : b.bookingId)}>
                              Receipt
                            </button>
                            {canCheckIn && (
                              <button type="button" className="btn btn-sm btn-outline-primary mr-1" onClick={() => checkIn(b)}>
                                Check in
                              </button>
                            )}
                            {canCancel && (
                              <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setConfirmId(b.bookingId)}>
                                Cancel
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                    {receiptId === b.bookingId && (
                      <tr><td colSpan="8"><pre className="receipt">{b.getReceipt()}</pre></td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

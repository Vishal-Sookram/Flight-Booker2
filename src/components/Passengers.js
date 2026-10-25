import React, { useState } from 'react';
import { useBookingService } from '../hooks/useBookingService';
import { BookingStatusBadge } from './StatusBadge';
import Notice from './Notice';
import { format } from '../domain/money';

const EMPTY = { fullName: '', email: '', passport: '', phone: '' };

/** Register passengers, see each one's bookings, and view their receipt. */
export default function Passengers() {
  const service = useBookingService();
  const [form, setForm] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState(null);
  const [message, setMessage] = useState(null);

  const passengers = service.getAllPassengers();
  const selected = selectedId ? service.getPassenger(selectedId) : null;
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  function handleRegister(e) {
    e.preventDefault();
    try {
      const p = service.registerPassenger(form);
      setForm(EMPTY);
      setSelectedId(p.passengerId);
      setMessage({ type: 'success', text: `Registered ${p.fullName} as ${p.passengerId}.` });
    } catch (err) {
      setMessage({ type: 'danger', text: err.message });
    }
  }

  return (
    <>
      <h2 className="page-title">Passengers</h2>
      {message && <Notice type={message.type} onClose={() => setMessage(null)}>{message.text}</Notice>}

      <div className="row">
        <div className="col-lg-4">
          <form className="panel" onSubmit={handleRegister}>
            <h4>Register a passenger</h4>
            <div className="form-group">
              <label htmlFor="p-name">Full name</label>
              <input id="p-name" className="form-control" value={form.fullName} onChange={set('fullName')} required />
            </div>
            <div className="form-group">
              <label htmlFor="p-email">Email</label>
              <input id="p-email" type="email" className="form-control" value={form.email} onChange={set('email')} required />
            </div>
            <div className="form-group">
              <label htmlFor="p-passport">Passport number</label>
              <input id="p-passport" className="form-control" value={form.passport} onChange={set('passport')} required />
            </div>
            <div className="form-group">
              <label htmlFor="p-phone">Mobile number (optional)</label>
              <input id="p-phone" type="tel" className="form-control" value={form.phone} onChange={set('phone')} />
            </div>
            <button type="submit" className="btn btn-primary btn-block">Register</button>
          </form>
        </div>

        <div className="col-lg-8">
          <div className="panel">
            <h4>All passengers ({passengers.length})</h4>
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr><th>ID</th><th>Name</th><th>Email</th><th>Mobile</th><th className="text-right">Active bookings</th></tr>
                </thead>
                <tbody>
                  {passengers.map((p) => (
                    <tr key={p.passengerId} className={`clickable${p.passengerId === selectedId ? ' row-selected' : ''}`}
                        onClick={() => setSelectedId(p.passengerId)}>
                      <td>{p.passengerId}</td>
                      <td>{p.fullName}</td>
                      <td>{p.email}</td>
                      <td>{p.phone || '—'}</td>
                      <td className="text-right">{p.bookings.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {selected && (
            <div className="panel">
              <h4>{selected.fullName} <small className="text-muted">{selected.passengerId} · passport {selected.passportNumber}</small></h4>
              <div className="table-responsive mb-3">
                <table className="table table-sm mb-0">
                  <thead><tr><th>Booking</th><th>Flight</th><th>Seat</th><th className="text-right">Fare</th><th>Status</th></tr></thead>
                  <tbody>
                    {service.getBookingsForPassenger(selected.passengerId).length === 0 && (
                      <tr><td colSpan="5" className="text-muted">No bookings yet.</td></tr>
                    )}
                    {service.getBookingsForPassenger(selected.passengerId).map((b) => (
                      <tr key={b.bookingId}>
                        <td>{b.bookingId}</td>
                        <td>{b.flight.flightNumber} · {b.flight.origin} → {b.flight.destination}</td>
                        <td>{b.seat ? `${b.seat.seatNumber} · ${b.seat.seatClass}${b.hasPrivateSuite ? ' Suite' : ''}` : 'Waitlist'}</td>
                        <td className="text-right">{format(b.calculateTotal())}</td>
                        <td><BookingStatusBadge status={b.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h6>Receipt</h6>
              <pre className="receipt">{selected.getReceipt()}</pre>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

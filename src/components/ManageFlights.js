import React, { useState } from 'react';
import { useBookingService } from '../hooks/useBookingService';
import { FlightStatusBadge } from './StatusBadge';
import Notice from './Notice';
import { FlightStatus } from '../domain/flight';
import { format } from '../domain/money';

const EMPTY = { flightNumber: '', origin: '', destination: '', departure: '', arrival: '' };

/** Staff screen: add flights, cancel a whole flight, and reset the demo data. */
export default function ManageFlights() {
  const service = useBookingService();
  const [form, setForm] = useState(EMPTY);
  const [confirm, setConfirm] = useState(null);        // flight id, or 'RESET'
  const [message, setMessage] = useState(null);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const flights = service.getAllFlights();
  const stats = service.getStats();

  function run(action) {
    try {
      action();
    } catch (err) {
      setMessage({ type: 'danger', text: err.message });
    }
  }

  const handleAdd = (e) => {
    e.preventDefault();
    run(() => {
      const flight = service.addFlight({
        flightNumber: form.flightNumber, origin: form.origin, destination: form.destination,
        departureTime: new Date(form.departure), arrivalTime: new Date(form.arrival),
      });
      setForm(EMPTY);
      setMessage({ type: 'success', text: `Added flight ${flight.flightNumber} (${flight.origin} → ${flight.destination}).` });
    });
  };

  const cancelFlight = (flight) => run(() => {
    const count = service.cancelFlight(flight.id);
    setConfirm(null);
    setMessage({ type: 'success', text: `Flight ${flight.flightNumber} cancelled. ${count} booking(s) were cancelled with it.` });
  });

  const reset = () => {
    service.resetDemoData();
    setConfirm(null);
    setMessage({ type: 'success', text: 'Demo data restored.' });
  };

  return (
    <>
      <h2 className="page-title">Manage flights</h2>
      {message && <Notice type={message.type} onClose={() => setMessage(null)}>{message.text}</Notice>}

      <div className="row stats">
        {[
          ['Flights on file', stats.flights],
          ['Passengers', stats.passengers],
          ['Seats sold', stats.seatsSold],
          ['Waitlisted', stats.byStatus.WAITLISTED ?? 0],
          ['Revenue', format(stats.revenue)],
        ].map(([label, value]) => (
          <div className="col-6 col-md" key={label}>
            <div className="panel stat"><div className="stat-value">{value}</div><div className="text-muted small">{label}</div></div>
          </div>
        ))}
      </div>

      <form className="panel" onSubmit={handleAdd}>
        <h4>Add a flight</h4>
        <div className="form-row">
          <div className="form-group col-md-2">
            <label htmlFor="f-number">Flight no.</label>
            <input id="f-number" className="form-control" placeholder="BA0117" value={form.flightNumber} onChange={set('flightNumber')} required />
          </div>
          <div className="form-group col-md-2">
            <label htmlFor="f-from">From</label>
            <input id="f-from" className="form-control" placeholder="LHR" value={form.origin} onChange={set('origin')} required />
          </div>
          <div className="form-group col-md-2">
            <label htmlFor="f-to">To</label>
            <input id="f-to" className="form-control" placeholder="JFK" value={form.destination} onChange={set('destination')} required />
          </div>
          <div className="form-group col-md-3">
            <label htmlFor="f-dep">Departs</label>
            <input id="f-dep" type="datetime-local" className="form-control" value={form.departure} onChange={set('departure')} required />
          </div>
          <div className="form-group col-md-3">
            <label htmlFor="f-arr">Arrives</label>
            <input id="f-arr" type="datetime-local" className="form-control" value={form.arrival} onChange={set('arrival')} required />
          </div>
        </div>
        <button type="submit" className="btn btn-primary">Add flight</button>
      </form>

      <div className="panel">
        <h4>Schedule</h4>
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr><th>Flight</th><th>Airline</th><th>Route</th><th>Departs</th><th>Status</th><th className="text-right">Active bookings</th><th /></tr>
            </thead>
            <tbody>
              {flights.map((f) => {
                const status = service.getFlightStatus(f);
                const active = service.getAllBookings().filter((b) => b.flight === f && b.isActive).length;
                const cancellable = status !== FlightStatus.DEPARTED && status !== FlightStatus.CANCELLED;
                return (
                  <tr key={f.id}>
                    <td><strong>{f.flightNumber}</strong></td>
                    <td>{f.airline || '—'}</td>
                    <td>{f.origin} → {f.destination}</td>
                    <td>{f.departureLabel}</td>
                    <td><FlightStatusBadge status={status} /></td>
                    <td className="text-right">{active}</td>
                    <td className="text-right text-nowrap">
                      {cancellable && confirm !== f.id && (
                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setConfirm(f.id)}>
                          Cancel flight
                        </button>
                      )}
                      {confirm === f.id && (
                        <>
                          <span className="small mr-2">Cancel it and all {active} booking(s)?</span>
                          <button type="button" className="btn btn-sm btn-danger mr-1" onClick={() => cancelFlight(f)}>Yes</button>
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setConfirm(null)}>No</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h4>Data</h4>
        <p className="text-muted">
          Everything is saved in this browser automatically. Resetting throws away all flights, passengers and
          bookings and restores the demo data.
        </p>
        {confirm === 'RESET' ? (
          <>
            <span className="mr-2">Really reset everything?</span>
            <button type="button" className="btn btn-sm btn-danger mr-1" onClick={reset}>Yes, reset</button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setConfirm(null)}>No</button>
          </>
        ) : (
          <button type="button" className="btn btn-outline-danger" onClick={() => setConfirm('RESET')}>Reset demo data</button>
        )}
      </div>
    </>
  );
}

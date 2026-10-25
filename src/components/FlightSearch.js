import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBookingService } from '../hooks/useBookingService';
import { FlightStatusBadge } from './StatusBadge';

/**
 * The flights currently on file (those added by hand, the demo flights, and any schedule flight someone has picked).
 * Blank fields mean "any". To search the whole airline schedule use the Search page.
 */
export default function FlightSearch() {
  const service = useBookingService();
  const navigate = useNavigate();
  const [criteria, setCriteria] = useState({ origin: '', destination: '', date: '' });

  const flights = service.searchFlights(criteria);
  const airports = [...new Set(service.getAllFlights().flatMap((f) => [f.origin, f.destination]))].sort();
  const set = (key) => (e) => setCriteria({ ...criteria, [key]: e.target.value });
  const filtering = criteria.origin || criteria.destination || criteria.date;

  return (
    <>
      <h2 className="page-title">Flights on file</h2>

      <form className="panel" onSubmit={(e) => e.preventDefault()}>
        <div className="form-row align-items-end">
          <div className="form-group col-md-3">
            <label htmlFor="origin">From</label>
            <input id="origin" className="form-control" list="airports" placeholder="Any, e.g. LHR"
                   value={criteria.origin} onChange={set('origin')} />
          </div>
          <div className="form-group col-md-3">
            <label htmlFor="destination">To</label>
            <input id="destination" className="form-control" list="airports" placeholder="Any, e.g. JFK"
                   value={criteria.destination} onChange={set('destination')} />
          </div>
          <div className="form-group col-md-3">
            <label htmlFor="date">Departure date</label>
            <input id="date" type="date" className="form-control" value={criteria.date} onChange={set('date')} />
          </div>
          <div className="form-group col-md-3">
            <button type="button" className="btn btn-outline-primary btn-block"
                    disabled={!filtering}
                    onClick={() => setCriteria({ origin: '', destination: '', date: '' })}>
              Show all flights
            </button>
          </div>
        </div>
        <datalist id="airports">
          {airports.map((code) => <option key={code} value={code} />)}
        </datalist>
      </form>

      <div className="panel">
        <p className="text-muted mb-2">
          {flights.length === 0 ? 'No flights found.' : `${flights.length} flight(s)`} · double-click a row to open its seat map · <Link to="/">search the full schedule</Link>
        </p>
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Flight</th><th>Airline</th><th>Route</th><th>Departs</th><th>Arrives</th>
                <th>Status</th><th>Seats free</th><th />
              </tr>
            </thead>
            <tbody>
              {flights.map((f) => {
                const status = service.getFlightStatus(f);
                const free = f.getAvailabilityByClass();
                const full = !f.hasAvailability();
                const waiting = service.getWaitlist(f.id).length;
                return (
                  <tr key={f.id} className="clickable"
                      onDoubleClick={() => navigate(`/book/${f.id}`)}>
                    <td><strong>{f.flightNumber}</strong></td>
                    <td>{f.airline || '—'}</td>
                    <td>{f.origin} → {f.destination}</td>
                    <td>{f.departureLabel}</td>
                    <td>{f.arrivalLabel}</td>
                    <td><FlightStatusBadge status={status} /></td>
                    <td className="availability">
                      {full ? <span className="badge badge-danger">Full{waiting > 0 ? ` · ${waiting} waiting` : ''}</span> : (
                        <>
                          <span title="First Class">F:{f.offersClass('First Class') ? free['First Class'] ?? 0 : '–'}</span>
                          <span title="Business">B:{f.offersClass('Business') ? free.Business ?? 0 : '–'}</span>
                          <span title="Economy">E:{f.offersClass('Economy') ? free.Economy ?? 0 : '–'}</span>
                        </>
                      )}
                    </td>
                    <td className="text-right">
                      <Link className={`btn btn-sm ${status.bookable ? 'btn-primary' : 'btn-outline-secondary'}`}
                            to={`/book/${f.id}`}>
                        {!status.bookable ? 'View seats' : full ? 'Join waitlist' : 'Select seat'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingService } from '../hooks/useBookingService';
import { useScheduleCatalog } from '../hooks/useScheduleCatalog';
import AirportInput from './AirportInput';
import { servedAirportCodes } from '../domain/airports';
import { CABINS } from '../domain/seat';
import { MAX_PASSENGERS } from '../domain/bookingService';
import { normaliseReference } from '../domain/reference';
import { toDateInputValue } from '../domain/dates';
import { addDaysToDateKey } from '../domain/timezones';

/** How far ahead flights can be booked. */
export const BOOKING_WINDOW_DAYS = 330;

const POPULAR = [
  ['DEL', 'BOM', 'Delhi → Mumbai'],
  ['BLR', 'HYD', 'Bangalore → Hyderabad'],
  ['JFK', 'LHR', 'New York → London'],
  ['DXB', 'LHR', 'Dubai → London'],
  ['LHR', 'DXB', 'London → Dubai'],
  ['SIN', 'LHR', 'Singapore → London'],
];

/** Home page: search one-way or return flights between any two airports with flights. */
export default function Home() {
  const service = useBookingService();
  const navigate = useNavigate();
  const { catalog, status } = useScheduleCatalog();

  const today = toDateInputValue(new Date());
  const lastDay = addDaysToDateKey(today, BOOKING_WINDOW_DAYS);
  const [form, setForm] = useState({
    trip: 'oneway', from: '', to: '', date: addDaysToDateKey(today, 14), returnDate: addDaysToDateKey(today, 21), cabin: CABINS[0], pax: 1,
  });
  const [errors, setErrors] = useState({});
  const [reference, setReference] = useState('');

  const handByHand = service.getAllFlights();
  const fromCodes = servedAirportCodes(handByHand.flatMap((f) => [f.origin, f.destination]));
  // Once the schedule is loaded, only offer destinations that can actually be reached from the chosen origin.
  let toCodes = fromCodes;
  if (form.from) {
    const reachable = new Set([
      ...(catalog ? catalog.destinationsFrom(form.from) : [...fromCodes]),
      ...handByHand.filter((f) => f.origin === form.from).map((f) => f.destination),
    ]);
    reachable.delete(form.from);
    toCodes = reachable;
  }

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const setFromInput = (key) => (e) => set(key)(e.target.value);

  function swap() {
    setForm((f) => ({ ...f, from: f.to, to: f.from }));
  }

  function setTrip(trip) {
    setForm((f) => ({ ...f, trip, returnDate: f.returnDate < f.date ? f.date : f.returnDate }));
  }

  function handleDate(e) {
    const date = e.target.value;
    setForm((f) => ({ ...f, date, returnDate: f.returnDate < date ? date : f.returnDate }));
  }

  function handleSearch(e) {
    e.preventDefault();
    const found = {};
    if (!form.from) found.from = 'Choose where you are flying from.';
    if (!form.to) found.to = 'Choose where you are flying to.';
    if (form.from && form.from === form.to) found.to = 'The two airports must be different.';
    if (!form.date) found.date = 'Choose a departure date.';
    else if (form.date < today) found.date = 'That date has passed.';
    else if (form.date > lastDay) found.date = `Flights can be booked up to ${BOOKING_WINDOW_DAYS} days ahead.`;
    if (form.trip === 'return') {
      if (!form.returnDate) found.returnDate = 'Choose a return date.';
      else if (form.returnDate < form.date) found.returnDate = 'The return cannot be before the departure.';
      else if (form.returnDate > lastDay) found.returnDate = `Flights can be booked up to ${BOOKING_WINDOW_DAYS} days ahead.`;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const query = new URLSearchParams({ from: form.from, to: form.to, date: form.date, cabin: form.cabin, pax: String(form.pax) });
    if (form.trip === 'return') query.set('return', form.returnDate);
    navigate(`/search?${query}`);
  }

  function handleFind(e) {
    e.preventDefault();
    const ref = normaliseReference(reference);
    if (ref) navigate(`/trip/${ref}`);
  }

  return (
    <>
      <h2 className="page-title">Find a flight</h2>

      <form className="panel" onSubmit={handleSearch} noValidate>
        <div className="btn-group btn-group-toggle mb-3" role="group" aria-label="Trip type">
          {[['oneway', 'One way'], ['return', 'Return']].map(([value, label]) => (
            <button key={value} type="button" className={`btn btn-outline-primary${form.trip === value ? ' active' : ''}`}
                    aria-pressed={form.trip === value} onClick={() => setTrip(value)}>
              {label}
            </button>
          ))}
        </div>

        <div className="form-row">
          <div className="form-group col-md-5">
            <AirportInput id="from" label="From" value={form.from} onChange={set('from')} codes={fromCodes} invalid={Boolean(errors.from)} />
            {errors.from && <div className="invalid-feedback d-block">{errors.from}</div>}
          </div>
          <div className="form-group col-md-2 d-flex align-items-end justify-content-center">
            <button type="button" className="btn btn-light swap-button" onClick={swap} aria-label="Swap origin and destination" title="Swap">⇄</button>
          </div>
          <div className="form-group col-md-5">
            <AirportInput id="to" label="To" value={form.to} onChange={set('to')} codes={toCodes} invalid={Boolean(errors.to)} />
            {errors.to && <div className="invalid-feedback d-block">{errors.to}</div>}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group col-md-3">
            <label htmlFor="date">Departing</label>
            <input id="date" type="date" className={`form-control${errors.date ? ' is-invalid' : ''}`} min={today} max={lastDay}
                   value={form.date} onChange={handleDate} />
            {errors.date && <div className="invalid-feedback">{errors.date}</div>}
          </div>
          <div className="form-group col-md-3">
            <label htmlFor="returnDate">Returning</label>
            <input id="returnDate" type="date" className={`form-control${errors.returnDate ? ' is-invalid' : ''}`} min={form.date || today} max={lastDay}
                   disabled={form.trip !== 'return'} value={form.trip === 'return' ? form.returnDate : ''} onChange={setFromInput('returnDate')} />
            {errors.returnDate && <div className="invalid-feedback">{errors.returnDate}</div>}
          </div>
          <div className="form-group col-md-3">
            <label htmlFor="cabin">Cabin</label>
            <select id="cabin" className="form-control" value={form.cabin} onChange={setFromInput('cabin')}>
              {CABINS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group col-md-3">
            <label htmlFor="pax">Passengers</label>
            <select id="pax" className="form-control" value={form.pax} onChange={(e) => set('pax')(Number(e.target.value))}>
              {Array.from({ length: MAX_PASSENGERS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        <button type="submit" className="btn btn-primary btn-lg">Search flights</button>
        <span className="text-muted small ml-3">
          {status === 'loading' && 'Loading the flight schedule…'}
          {status === 'error' && 'The flight schedule could not be loaded, so only flights already on file can be searched.'}
          {status === 'ready' && `${catalog.size.toLocaleString()} weekly flights on ${catalog.servedAirports().size} airports`}
        </span>
      </form>

      <div className="row">
        <div className="col-lg-7">
          <div className="panel">
            <h4>Popular routes</h4>
            <div className="chips">
              {POPULAR.map(([from, to, label]) => (
                <button key={label} type="button" className="btn btn-sm btn-outline-secondary"
                        onClick={() => setForm((f) => ({ ...f, from, to }))}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="col-lg-5">
          <form className="panel" onSubmit={handleFind}>
            <h4>Find a booking</h4>
            <div className="input-group">
              <input className="form-control" aria-label="Booking reference" placeholder="Reference, e.g. K7M2QX"
                     value={reference} onChange={(e) => setReference(e.target.value)} />
              <div className="input-group-append">
                <button type="submit" className="btn btn-outline-primary" disabled={!normaliseReference(reference)}>Find</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

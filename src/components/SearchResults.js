import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useBookingService } from '../hooks/useBookingService';
import { useScheduleCatalog } from '../hooks/useScheduleCatalog';
import { airportLabel, cityOf } from '../domain/airports';
import { CABINS } from '../domain/seat';
import { MAX_PASSENGERS } from '../domain/bookingService';
import { formatDuration, toDateInputValue } from '../domain/dates';
import { format } from '../domain/money';
import { addDaysToDateKey, dateKeyOf, daysBetweenKeys, formatDateKeyLong, formatDateKeyShort, isValidDateKey } from '../domain/timezones';
import {
  TIME_SLOTS, SORTS, airlinesIn, filterOptions, isValidReturn, priceRange, sortOptions,
} from '../domain/tripSearch';

/** Reads and checks the search in the address bar. Returns null if it is not a usable search. */
function readSearch(params) {
  const from = (params.get('from') ?? '').toUpperCase();
  const to = (params.get('to') ?? '').toUpperCase();
  const date = params.get('date') ?? '';
  const returnDate = params.get('return') ?? '';
  const cabin = CABINS.includes(params.get('cabin')) ? params.get('cabin') : CABINS[0];
  const pax = Math.min(Math.max(parseInt(params.get('pax'), 10) || 1, 1), MAX_PASSENGERS);
  if (!from || !to || from === to || !isValidDateKey(date)) return null;
  if (returnDate && (!isValidDateKey(returnDate) || returnDate < date)) return null;
  return { from, to, date, returnDate, cabin, pax };
}

/** Results of a search (route: /search?from=DEL&to=BOM&date=2027-01-15&return=...&cabin=Economy&pax=2). */
export default function SearchResults() {
  const [params] = useSearchParams();
  const search = readSearch(params);
  if (!search) {
    return (
      <div className="panel">
        <h2>That search is not valid</h2>
        <p className="mt-2"><Link to="/">Start a new search</Link></p>
      </div>
    );
  }
  // A new origin, destination, outbound date, cabin or party size starts afresh; changing only the return date does not.
  const key = [search.from, search.to, search.date, search.cabin, search.pax, search.returnDate ? 'return' : 'oneway'].join('|');
  return <ResultsView key={key} search={search} />;
}

function ResultsView({ search }) {
  const { from, to, date, returnDate, cabin, pax } = search;
  const service = useBookingService();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { catalog, status } = useScheduleCatalog();
  const [outbound, setOutbound] = useState(null);

  const onReturnLeg = Boolean(returnDate) && outbound !== null;
  const leg = onReturnLeg ? { origin: to, destination: from, date: returnDate } : { origin: from, destination: to, date };
  const today = toDateInputValue(new Date());

  let options = status === 'loading' ? [] : service.searchOptions(catalog, { ...leg, cabin });
  if (onReturnLeg) options = options.filter((o) => isValidReturn(outbound, o));

  const earliest = onReturnLeg ? date : today;                       // the strip never goes before today (or the outbound day)
  const centre = addDaysToDateKey(leg.date, -3);
  const stripStart = centre < earliest ? earliest : centre;
  const strip = status === 'ready'
    ? service.cheapestByDate(catalog, { origin: leg.origin, destination: leg.destination, cabin, startDate: stripStart, days: 7 })
    : [];

  function chooseDate(newDate) {
    const next = new URLSearchParams(params);
    if (onReturnLeg) {
      next.set('return', newDate);
    } else {
      next.set('date', newDate);
      if (returnDate && returnDate < newDate) next.set('return', newDate);
    }
    setParams(next);
  }

  function select(option) {
    if (returnDate && !onReturnLeg) {
      setOutbound(option);
      window.scrollTo(0, 0);
      return;
    }
    const outFlight = service.ensureFlight(onReturnLeg ? outbound : option);
    const query = new URLSearchParams({ out: outFlight.id, cabin, pax: String(pax) });
    if (onReturnLeg) query.set('ret', service.ensureFlight(option).id);
    navigate(`/checkout?${query}`);
  }

  function joinWaitlist(option) {
    navigate(`/book/${service.ensureFlight(option).id}`);
  }

  const routeKnown = (catalog && catalog.hasRoute(leg.origin, leg.destination))
    || service.getAllFlights().some((f) => f.origin === leg.origin && f.destination === leg.destination);

  return (
    <>
      <p className="mb-2"><Link to="/">← Change search</Link></p>
      <div className="panel search-summary">
        <div>
          <h2>{cityOf(leg.origin)} <span className="text-muted">→</span> {cityOf(leg.destination)}</h2>
          <p className="text-muted mb-0">
            {formatDateKeyLong(leg.date)} · {cabin} · {pax} passenger{pax > 1 ? 's' : ''}
            {returnDate && ` · ${onReturnLeg ? 'Step 2 of 2: choose your return flight' : 'Step 1 of 2: choose your outbound flight'}`}
          </p>
        </div>
      </div>

      {onReturnLeg && (
        <div className="alert alert-info d-flex justify-content-between align-items-center">
          <span>
            Outbound: <strong>{outbound.airline} {outbound.flightNumber}</strong>, {formatDateKeyShort(dateKeyOf(outbound.departureTime, outbound.flight.originTimeZone))}{' '}
            {outbound.flight.departureClock} · {format(outbound.prices[cabin])} per person
          </span>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setOutbound(null)}>Change</button>
        </div>
      )}

      {strip.length > 0 && (
        <div className="panel date-strip" role="group" aria-label="Nearby dates">
          {strip.map(({ date: day, price }) => (
            <button key={day} type="button" disabled={price == null && day !== leg.date}
                    className={`btn date-cell${day === leg.date ? ' selected' : ''}`} onClick={() => chooseDate(day)}>
              <span>{formatDateKeyShort(day)}</span>
              <strong>{price == null ? '—' : format(price)}</strong>
            </button>
          ))}
        </div>
      )}

      {status === 'loading' && <div className="panel text-muted">Loading flights…</div>}
      {status === 'error' && <Notice>The flight schedule could not be loaded; only flights already on file are shown.</Notice>}

      {status !== 'loading' && options.length === 0 && (
        <div className="panel">
          <h4>No {cabin} flights found</h4>
          <p className="text-muted mb-0">
            {!routeKnown
              ? `There are no flights between ${airportLabel(leg.origin)} and ${airportLabel(leg.destination)}.`
              : onReturnLeg
                ? 'Nothing leaves late enough after your outbound flight lands. Try a later date above.'
                : 'Nothing operates on this date in this cabin. Try one of the dates above, or another cabin.'}
          </p>
        </div>
      )}

      {options.length > 0 && (
        <LegResults key={onReturnLeg ? 'return' : 'outbound'} options={options} cabin={cabin} pax={pax}
                    onSelect={select} onWaitlist={joinWaitlist} selectLabel={returnDate && !onReturnLeg ? 'Select outbound' : returnDate ? 'Select return' : 'Select'} />
      )}
    </>
  );
}

function Notice({ children }) {
  return <div className="alert alert-warning">{children}</div>;
}

/** Filters, sort order and the list of flights for one direction of the trip. */
function LegResults({ options, cabin, pax, onSelect, onWaitlist, selectLabel }) {
  const [filters, setFilters] = useState({ maxPrice: null, departSlots: [], arriveSlots: [], airlines: [] });
  const [sort, setSort] = useState('price');

  const range = priceRange(options, cabin);
  const minPounds = Math.floor(range.min / 100);
  const maxPounds = Math.ceil(range.max / 100);
  const sliderValue = filters.maxPrice == null ? maxPounds : Math.ceil(filters.maxPrice / 100);
  const airlines = airlinesIn(options);
  const shown = sortOptions(filterOptions(options, { cabin, ...filters }), sort, cabin);
  const filtered = filters.maxPrice != null || filters.departSlots.length > 0 || filters.arriveSlots.length > 0 || filters.airlines.length > 0;

  const toggle = (key) => (value) => setFilters((f) => ({
    ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
  }));
  const reset = () => setFilters({ maxPrice: null, departSlots: [], arriveSlots: [], airlines: [] });

  return (
    <div className="row">
      <div className="col-lg-3">
        <div className="panel filters">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h5 className="mb-0">Filters</h5>
            <button type="button" className="btn btn-link btn-sm p-0" onClick={reset} disabled={!filtered}>Reset</button>
          </div>

          {maxPounds > minPounds && (
            <div className="form-group">
              <label htmlFor="max-price">Up to <strong>{format(sliderValue * 100)}</strong></label>
              <input id="max-price" type="range" className="custom-range" min={minPounds} max={maxPounds} value={sliderValue}
                     onChange={(e) => {
                       const pounds = Number(e.target.value);
                       setFilters((f) => ({ ...f, maxPrice: pounds >= maxPounds ? null : pounds * 100 }));
                     }} />
            </div>
          )}

          <SlotFilter title="Departure time" selected={filters.departSlots} onToggle={toggle('departSlots')} />
          <SlotFilter title="Arrival time" selected={filters.arriveSlots} onToggle={toggle('arriveSlots')} />

          {airlines.length > 1 && (
            <fieldset className="form-group">
              <legend className="filter-legend">Airlines</legend>
              {airlines.map((name) => (
                <div className="custom-control custom-checkbox" key={name}>
                  <input type="checkbox" className="custom-control-input" id={`airline-${name}`}
                         checked={filters.airlines.includes(name)} onChange={() => toggle('airlines')(name)} />
                  <label className="custom-control-label" htmlFor={`airline-${name}`}>{name}</label>
                </div>
              ))}
            </fieldset>
          )}
        </div>
      </div>

      <div className="col-lg-9">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className="text-muted">{shown.length} of {options.length} flight{options.length === 1 ? '' : 's'}</span>
          <div className="form-inline">
            <label htmlFor="sort" className="mr-2 mb-0">Sort by</label>
            <select id="sort" className="form-control form-control-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {shown.length === 0 && (
          <div className="panel text-muted">No flights match these filters. <button type="button" className="btn btn-link p-0" onClick={reset}>Reset filters</button></div>
        )}
        {shown.map((option) => (
          <OptionCard key={option.id} option={option} cabin={cabin} pax={pax} selectLabel={selectLabel}
                      onSelect={() => onSelect(option)} onWaitlist={() => onWaitlist(option)} />
        ))}
      </div>
    </div>
  );
}

function SlotFilter({ title, selected, onToggle }) {
  return (
    <fieldset className="form-group">
      <legend className="filter-legend">{title}</legend>
      <div className="slot-grid">
        {TIME_SLOTS.map((slot) => (
          <button key={slot.id} type="button" title={slot.hint} aria-pressed={selected.includes(slot.id)}
                  className={`btn btn-sm ${selected.includes(slot.id) ? 'btn-primary' : 'btn-outline-secondary'}`}
                  onClick={() => onToggle(slot.id)}>
            {slot.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function OptionCard({ option, cabin, pax, selectLabel, onSelect, onWaitlist }) {
  const { flight } = option;
  const price = option.prices[cabin];
  const listPrice = option.listPrices[cabin];
  const left = option.availability[cabin] ?? 0;
  const soldOut = option.seatsLeft === 0;
  const arrivalDay = daysBetweenKeys(flight.departureDateKey, dateKeyOf(flight.arrivalTime, flight.destinationTimeZone));

  return (
    <div className="panel option-card">
      <div className="row align-items-center">
        <div className="col-md-3">
          <strong>{option.airline || 'Flight'}</strong>
          <div className="text-muted small">{option.flightNumber}</div>
        </div>
        <div className="col-md-5">
          <div className="d-flex justify-content-between align-items-center option-times">
            <div><span className="time">{flight.departureClock}</span><div className="small text-muted">{option.origin}</div></div>
            <div className="text-center small text-muted option-duration">
              {formatDuration(option.durationMinutes)}
              <div className="option-line" />
            </div>
            <div className="text-right">
              <span className="time">{flight.arrivalClock}</span>{arrivalDay > 0 && <sup className="text-danger"> +{arrivalDay}</sup>}
              <div className="small text-muted">{option.destination}</div>
            </div>
          </div>
        </div>
        <div className="col-md-4 text-md-right mt-2 mt-md-0">
          {price < listPrice && <span className="price-strike">{format(listPrice)}</span>}
          <span className="price-now">{format(price)}</span>
          <div className="small text-muted">
            per person{pax > 1 && ` · ${format(price * pax)} for ${pax}`}
            {price < listPrice && <span className="badge badge-success ml-1">Early bird −10%</span>}
          </div>
          <div className="mt-2">
            {soldOut ? (
              <>
                <span className="badge badge-danger mr-2">Sold out</span>
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={onWaitlist}>Join waitlist</button>
              </>
            ) : left >= pax ? (
              <>
                {left <= 9 && <span className="badge badge-warning mr-2">Only {left} left</span>}
                <button type="button" className="btn btn-primary" onClick={onSelect}>{selectLabel}</button>
              </>
            ) : (
              <span className="badge badge-secondary">{left === 0 ? `No ${cabin} seats left` : `Only ${left} ${cabin} seat${left > 1 ? 's' : ''} left`}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

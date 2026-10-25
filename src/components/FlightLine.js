import React from 'react';
import { cityOf } from '../domain/airports';
import { formatDuration } from '../domain/dates';

/** One flight described in two lines: who flies it and where, then local departure / arrival times. */
export default function FlightLine({ flight }) {
  return (
    <div className="flight-line">
      <strong>{flight.airline ? `${flight.airline} ` : ''}{flight.flightNumber}</strong>
      {' · '}{cityOf(flight.origin)} ({flight.origin}) → {cityOf(flight.destination)} ({flight.destination})
      <div className="text-muted small">
        Departs {flight.departureLabel} · Arrives {flight.arrivalLabel} · {formatDuration(flight.durationMinutes)}
      </div>
    </div>
  );
}

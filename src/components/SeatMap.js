import React from 'react';
import { format } from '../domain/money';

const CSS_CLASS = { 'First Class': 'first', Business: 'business', Economy: 'economy' };

/** Groups the flight's seats into cabins -> rows, in layout order. */
function groupIntoCabins(flight) {
  const cabins = [];
  for (const seat of flight.seats) {
    const row = parseInt(seat.seatNumber, 10);
    let cabin = cabins[cabins.length - 1];
    if (!cabin || cabin.seatClass !== seat.seatClass) {
      cabin = { seatClass: seat.seatClass, rows: [] };
      cabins.push(cabin);
    }
    let last = cabin.rows[cabin.rows.length - 1];
    if (!last || last.row !== row) {
      last = { row, seats: [] };
      cabin.rows.push(last);
    }
    last.seats.push(seat);
  }
  return cabins;
}

function SeatButton({ seat, fare, tag, selected, interactive, onSelect }) {
  const suiteBooked = seat.supportsPrivateSuite && seat.hasPrivateSuite;
  const classes = ['seat', CSS_CLASS[seat.seatClass]];
  if (seat.isOccupied) classes.push('occupied');
  if (suiteBooked) classes.push('suite');
  if (selected) classes.push('selected');

  const title = seat.isOccupied
    ? `${seat.seatNumber} · ${seat.seatClass} · taken by ${seat.passengerName}`
    : `${seat.seatNumber} · ${seat.seatClass} · ${format(fare)} · ${seat.perks}`;

  return (
    <button
      type="button"
      className={classes.join(' ')}
      title={title}
      aria-label={title}
      aria-pressed={selected}
      disabled={seat.isOccupied || !interactive}
      onClick={() => onSelect(seat.seatNumber)}
    >
      {seat.seatNumber}{suiteBooked ? '★' : ''}{tag != null && <sup className="seat-tag">{tag}</sup>}
    </button>
  );
}

/**
 * The visual seat map. Premium cabins are 2 + 2 across, economy is 3 + 3, with the aisle in the middle.
 * Cabins the flight does not sell are left out.
 *
 * `selectedSeat` highlights one seat; `selectedSeats` several (for a group). `seatTags` puts a small label on
 * seats, e.g. { '12A': 1 } to show which passenger holds them.
 * `interactive` turns the seat buttons on or off (off when the flight is closed or full).
 */
export default function SeatMap({ flight, selectedSeat = null, selectedSeats = [], seatTags = {}, interactive = true, onSelect = () => {} }) {
  const picked = new Set(selectedSeat ? [selectedSeat, ...selectedSeats] : selectedSeats);
  return (
    <div className="seatmap">
      <div className="seat-legend">
        <span><i className="swatch first" /> First Class</span>
        <span><i className="swatch business" /> Business</span>
        <span><i className="swatch economy" /> Economy</span>
        <span><i className="swatch occupied" /> Taken</span>
        <span><i className="swatch suite" /> Private suite ★</span>
        <span><i className="swatch selected" /> Your choice</span>
      </div>

      {groupIntoCabins(flight).filter((cabin) => flight.offersClass(cabin.seatClass)).map((cabin) => (
        <section key={cabin.seatClass}>
          <h6 className="cabin-title">{cabin.seatClass}</h6>
          {cabin.rows.map(({ row, seats }) => {
            const half = Math.ceil(seats.length / 2);
            const renderSeat = (seat) => (
              <SeatButton
                key={seat.seatNumber}
                seat={seat}
                fare={flight.baseFareFor(seat)}
                tag={seatTags[seat.seatNumber]}
                selected={picked.has(seat.seatNumber)}
                interactive={interactive}
                onSelect={onSelect}
              />
            );
            return (
              <div className="seat-row" key={row}>
                <span className="row-label">{row}</span>
                {seats.slice(0, half).map(renderSeat)}
                <span className="aisle" />
                {seats.slice(half).map(renderSeat)}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

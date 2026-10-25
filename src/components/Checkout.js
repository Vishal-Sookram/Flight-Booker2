import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useBookingService } from '../hooks/useBookingService';
import SeatMap from './SeatMap';
import FlightLine from './FlightLine';
import { CABINS } from '../domain/seat';
import { MAX_PASSENGERS } from '../domain/bookingService';
import { findSeatsTogether } from '../domain/seatSelection';
import { format } from '../domain/money';
import { MockPaymentGateway, PaymentError, formatCardNumber, validateCard } from '../domain/payment';

// One demo gateway for the whole app. Swap it for a real provider's client to take real payments.
const gateway = new MockPaymentGateway();

const STEPS = ['Passengers', 'Seats', 'Payment'];
const blankTraveller = () => ({ mode: 'new', passengerId: '', fullName: '', email: '', passport: '', phone: '' });

/** Book a trip for one or more passengers (route: /checkout?out=<flight id>&ret=<flight id>&cabin=Economy&pax=2). */
export default function Checkout() {
  const [params] = useSearchParams();
  const service = useBookingService();
  const out = service.getFlight(params.get('out') ?? '');
  const returnId = params.get('ret');
  const back = returnId ? service.getFlight(returnId) : null;
  const cabin = CABINS.includes(params.get('cabin')) ? params.get('cabin') : CABINS[0];
  const pax = Math.min(Math.max(parseInt(params.get('pax'), 10) || 1, 1), MAX_PASSENGERS);

  if (!out || (returnId && !back)) {
    return (
      <div className="panel">
        <h2>We could not find that flight</h2>
        <p className="mt-2">It may have been removed. <Link to="/">Search again</Link></p>
      </div>
    );
  }
  return <CheckoutFlow key={`${out.id}|${back ? back.id : ''}|${pax}`} legs={back ? [out, back] : [out]} cabin={cabin} pax={pax} />;
}

function CheckoutFlow({ legs, cabin, pax }) {
  const service = useBookingService();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [travellers, setTravellers] = useState(() => Array.from({ length: pax }, blankTraveller));
  const [travellerErrors, setTravellerErrors] = useState([]);
  const [seatChoices, setSeatChoices] = useState(() => legs.map(() => Array(pax).fill(null)));   // [leg][passenger] -> { seatNumber, suite } | null
  const [activeLeg, setActiveLeg] = useState(0);
  const [activePax, setActivePax] = useState(0);
  const [seatMessage, setSeatMessage] = useState('');
  const [card, setCard] = useState({ number: '', holder: '', expiryMonth: '', expiryYear: '', cvv: '' });
  const [cardErrors, setCardErrors] = useState({});
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const nameOf = (traveller, index) => {
    if (traveller.mode === 'existing') return service.getPassenger(traveller.passengerId)?.fullName ?? `Passenger ${index + 1}`;
    return traveller.fullName.trim() || `Passenger ${index + 1}`;
  };

  // ── Step 1: passengers ──────────────────────────────────────────────────────────────────────

  function validateTravellers() {
    const errors = travellers.map(() => '');
    const people = new Set();
    const passports = new Set();
    travellers.forEach((t, i) => {
      if (t.mode === 'existing') {
        const person = service.getPassenger(t.passengerId);
        if (!person) errors[i] = 'Choose a passenger.';
        else if (people.has(person.passengerId)) errors[i] = `${person.fullName} is already added.`;
        else {
          const busy = legs.find((flight) => service.hasActiveBooking(person, flight));
          if (busy) errors[i] = `${person.fullName} already has a booking on ${busy.flightNumber}.`;
        }
        if (person) people.add(person.passengerId);
      } else {
        try {
          service.validateNewPassenger(t);
          const passport = t.passport.trim().toUpperCase();
          if (passports.has(passport)) errors[i] = `Passport ${passport} is entered twice.`;
          passports.add(passport);
        } catch (error) {
          errors[i] = error.message;
        }
      }
    });
    return errors;
  }

  function continueFromPassengers() {
    const errors = validateTravellers();
    setTravellerErrors(errors);
    if (errors.every((e) => e === '')) setStep(1);
  }

  const updateTraveller = (index, changes) => setTravellers((all) => all.map((t, i) => (i === index ? { ...t, ...changes } : t)));

  // ── Step 2: seats ───────────────────────────────────────────────────────────────────────────

  const flight = legs[activeLeg];
  const choices = seatChoices[activeLeg];

  function pickSeat(seatNumber) {
    const row = [...choices];
    const holder = row.findIndex((c) => c && c.seatNumber === seatNumber);
    if (holder === activePax) {
      row[activePax] = null;                                    // clicking your own seat again lets it go
    } else {
      if (holder >= 0) row[holder] = null;                      // taking a seat from another passenger in the group
      row[activePax] = { seatNumber, suite: false };
    }
    setSeatChoices((all) => all.map((r, i) => (i === activeLeg ? row : r)));
    setSeatMessage('');
    const next = row.findIndex((c, i) => !c && i !== activePax);
    if (row[activePax] && next >= 0) setActivePax(next);
  }

  function setSuite(legIndex, paxIndex, suite) {
    setSeatChoices((all) => all.map((r, i) => (i === legIndex ? r.map((c, j) => (j === paxIndex ? { ...c, suite } : c)) : r)));
  }

  function autoSeat() {
    const next = [];
    for (const f of legs) {
      const seats = findSeatsTogether(f, cabin, pax);
      if (!seats) {
        setSeatMessage(`Flight ${f.flightNumber} does not have ${pax} free ${cabin} seats together - please choose seats on the map.`);
        return;
      }
      next.push(seats.map((seatNumber) => ({ seatNumber, suite: false })));
    }
    setSeatChoices(next);
    setSeatMessage('');
  }

  const allSeated = seatChoices.every((row) => row.every(Boolean));
  const seatTags = {};
  choices.forEach((c, i) => { if (c) seatTags[c.seatNumber] = i + 1; });

  const seatPrice = (f, c) => service.quote(f, f.getSeat(c.seatNumber), c.suite);
  const seatListPrice = (f, c) => service.listPrice(f, f.getSeat(c.seatNumber), c.suite);

  // ── Step 3: payment ─────────────────────────────────────────────────────────────────────────

  const total = allSeated
    ? legs.reduce((sum, f, l) => sum + seatChoices[l].reduce((s, c) => s + seatPrice(f, c), 0), 0)
    : 0;

  function buildRequest() {
    return {
      passengers: travellers.map((t) => (t.mode === 'existing'
        ? { passengerId: t.passengerId }
        : { details: { fullName: t.fullName, email: t.email, passport: t.passport, phone: t.phone } })),
      legs: legs.map((f, l) => ({ flightId: f.id, seats: seatChoices[l].map((c) => ({ seatNumber: c.seatNumber, privateSuite: c.suite })) })),
    };
  }

  async function pay(e) {
    e.preventDefault();
    setPayError('');
    const { valid, errors } = validateCard(card);
    setCardErrors(errors);
    if (!valid) return;

    const request = buildRequest();
    try {
      service.checkReservation(request);                       // are the seats still free? (before any money moves)
    } catch (error) {
      setPayError(`${error.message} Please check your seats.`);
      setStep(1);
      return;
    }

    setPaying(true);
    try {
      const payment = await gateway.charge({ amount: total, card });
      const result = service.createReservation(request);
      navigate(`/trip/${result.reference}`, { replace: true, state: { paid: { amount: payment.amount, brand: payment.brand, last4: payment.last4, transactionId: payment.transactionId } } });
    } catch (error) {
      if (!mounted.current) return;
      setPayError(error instanceof PaymentError ? error.message : `Something went wrong: ${error.message}`);
      setPaying(false);
    }
  }

  const years = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() + i);

  return (
    <>
      <h2 className="page-title">Book your trip</h2>

      <ol className="steps" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span>{i + 1}</span> {label}
          </li>
        ))}
      </ol>

      <div className="panel">
        {legs.map((f, i) => (
          <div key={f.id}>
            {legs.length > 1 && <span className="badge badge-secondary mr-2">{i === 0 ? 'Outbound' : 'Return'}</span>}
            <FlightLine flight={f} />
          </div>
        ))}
        <div className="small text-muted mt-1">{pax} passenger{pax > 1 ? 's' : ''} · {cabin}</div>
      </div>

      {step === 0 && (
        <div>
          {travellers.map((t, i) => (
            <TravellerFields key={i} index={i} traveller={t} error={travellerErrors[i]}
                             passengers={service.getAllPassengers()}
                             onChange={(changes) => updateTraveller(i, changes)} />
          ))}
          <p className="text-muted small">The first passenger is the booking contact.</p>
          <button type="button" className="btn btn-primary" onClick={continueFromPassengers}>Continue to seats</button>
        </div>
      )}

      {step === 1 && (
        <div className="row">
          <div className="col-lg-7">
            <div className="panel">
              {legs.length > 1 && (
                <ul className="nav nav-tabs mb-3">
                  {legs.map((f, i) => (
                    <li className="nav-item" key={f.id}>
                      <button type="button" className={`nav-link${i === activeLeg ? ' active' : ''}`}
                              onClick={() => { setActiveLeg(i); setActivePax(0); }}>
                        {i === 0 ? 'Outbound' : 'Return'} · {f.origin} → {f.destination}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <SeatMap flight={flight} selectedSeats={choices.filter(Boolean).map((c) => c.seatNumber)} seatTags={seatTags}
                       interactive onSelect={pickSeat} />
            </div>
          </div>
          <div className="col-lg-5">
            <div className="panel">
              <h4>Seats for {flight.flightNumber}</h4>
              <p className="text-muted small">Pick a passenger, then a seat on the map.</p>
              <ul className="list-unstyled passenger-seats">
                {travellers.map((t, i) => {
                  const c = choices[i];
                  const seat = c ? flight.getSeat(c.seatNumber) : null;
                  return (
                    <li key={i} className={i === activePax ? 'active' : ''}>
                      <button type="button" className="btn btn-link p-0 text-left" onClick={() => setActivePax(i)} aria-pressed={i === activePax}>
                        <span className="seat-tag-badge">{i + 1}</span> {nameOf(t, i)}
                      </button>
                      <div className="small">
                        {c ? (
                          <>
                            Seat <strong>{c.seatNumber}</strong> · {seat.seatClass} ·{' '}
                            {seatPrice(flight, c) < seatListPrice(flight, c) && <span className="price-strike">{format(seatListPrice(flight, c))}</span>}
                            <strong>{format(seatPrice(flight, c))}</strong>
                            {seat.supportsPrivateSuite && (
                              <div className="custom-control custom-checkbox">
                                <input type="checkbox" className="custom-control-input" id={`suite-${activeLeg}-${i}`}
                                       checked={c.suite} onChange={(e) => setSuite(activeLeg, i, e.target.checked)} />
                                <label className="custom-control-label" htmlFor={`suite-${activeLeg}-${i}`}>Private suite (+£200)</label>
                              </div>
                            )}
                          </>
                        ) : <span className="text-muted">No seat chosen yet</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {seatMessage && <div className="alert alert-warning py-2">{seatMessage}</div>}
              {payError && <div className="alert alert-danger py-2">{payError}</div>}
              <button type="button" className="btn btn-outline-primary btn-sm mb-3" onClick={autoSeat}>
                Seat us together in {cabin}{legs.length > 1 ? ' on both flights' : ''}
              </button>
              <div className="d-flex justify-content-between">
                <button type="button" className="btn btn-light" onClick={() => setStep(0)}>Back</button>
                <button type="button" className="btn btn-primary" disabled={!allSeated} onClick={() => { setPayError(''); setStep(2); }}>
                  Continue to payment
                </button>
              </div>
              {!allSeated && <p className="small text-muted mt-2 mb-0">Every passenger needs a seat on {legs.length > 1 ? 'both flights' : 'the flight'}.</p>}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="row">
          <div className="col-lg-6">
            <div className="panel">
              <h4>Your trip</h4>
              <table className="table table-sm">
                <tbody>
                  {legs.map((f, l) => seatChoices[l].map((c, i) => (
                    <tr key={`${f.id}-${i}`}>
                      <td>{f.flightNumber} {f.origin}→{f.destination}<div className="small text-muted">{nameOf(travellers[i], i)} · seat {c.seatNumber}{c.suite ? ' · private suite' : ''}</div></td>
                      <td className="text-right">
                        {seatPrice(f, c) < seatListPrice(f, c) && <div className="price-strike">{format(seatListPrice(f, c))}</div>}
                        {format(seatPrice(f, c))}
                      </td>
                    </tr>
                  )))}
                </tbody>
                <tfoot>
                  <tr><th>Total</th><th className="text-right">{format(total)}</th></tr>
                </tfoot>
              </table>
              <button type="button" className="btn btn-light btn-sm" onClick={() => setStep(1)} disabled={paying}>← Change seats</button>
            </div>
          </div>
          <div className="col-lg-6">
            <form className="panel" onSubmit={pay} noValidate>
              <h4>Payment</h4>
              <div className="alert alert-info py-2 small">
                Demo checkout: no money is taken and card details are not stored. Use <code>4242 4242 4242 4242</code>, any future expiry and any
                code. <code>4000 0000 0000 0002</code> is always declined.
              </div>
              {payError && <div className="alert alert-danger py-2" role="alert">{payError}</div>}
              <div className="form-group">
                <label htmlFor="cc-number">Card number</label>
                <input id="cc-number" className={`form-control${cardErrors.number ? ' is-invalid' : ''}`} inputMode="numeric" autoComplete="off"
                       placeholder="4242 4242 4242 4242" value={card.number} onChange={(e) => setCard({ ...card, number: formatCardNumber(e.target.value) })} />
                {cardErrors.number && <div className="invalid-feedback">{cardErrors.number}</div>}
              </div>
              <div className="form-group">
                <label htmlFor="cc-name">Name on card</label>
                <input id="cc-name" className={`form-control${cardErrors.holder ? ' is-invalid' : ''}`} autoComplete="off"
                       value={card.holder} onChange={(e) => setCard({ ...card, holder: e.target.value })} />
                {cardErrors.holder && <div className="invalid-feedback">{cardErrors.holder}</div>}
              </div>
              <div className="form-row">
                <div className="form-group col-4">
                  <label htmlFor="cc-month">Month</label>
                  <select id="cc-month" className={`form-control${cardErrors.expiry ? ' is-invalid' : ''}`} value={card.expiryMonth}
                          onChange={(e) => setCard({ ...card, expiryMonth: e.target.value })}>
                    <option value="">MM</option>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
                  </select>
                </div>
                <div className="form-group col-4">
                  <label htmlFor="cc-year">Year</label>
                  <select id="cc-year" className={`form-control${cardErrors.expiry ? ' is-invalid' : ''}`} value={card.expiryYear}
                          onChange={(e) => setCard({ ...card, expiryYear: e.target.value })}>
                    <option value="">YYYY</option>
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div className="form-group col-4">
                  <label htmlFor="cc-cvv">Security code</label>
                  <input id="cc-cvv" className={`form-control${cardErrors.cvv ? ' is-invalid' : ''}`} inputMode="numeric" autoComplete="off" maxLength={4}
                         value={card.cvv} onChange={(e) => setCard({ ...card, cvv: e.target.value.replace(/\D/g, '') })} />
                </div>
              </div>
              {(cardErrors.expiry || cardErrors.cvv) && <div className="text-danger small mb-2">{cardErrors.expiry} {cardErrors.cvv}</div>}
              <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={paying}>
                {paying ? 'Processing payment…' : `Pay ${format(total)}`}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/** One passenger's details: pick someone already registered, or type in a new person. */
function TravellerFields({ index, traveller, error, passengers, onChange }) {
  const id = (name) => `traveller-${index}-${name}`;
  const set = (key) => (e) => onChange({ [key]: e.target.value });
  const isNew = traveller.mode === 'new';
  return (
    <div className="panel">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h5 className="mb-0">Passenger {index + 1}</h5>
        {passengers.length > 0 && (
          <div className="btn-group btn-group-sm" role="group" aria-label={`Passenger ${index + 1} type`}>
            <button type="button" className={`btn btn-outline-secondary${isNew ? ' active' : ''}`} onClick={() => onChange({ mode: 'new' })}>New</button>
            <button type="button" className={`btn btn-outline-secondary${!isNew ? ' active' : ''}`} onClick={() => onChange({ mode: 'existing' })}>Already registered</button>
          </div>
        )}
      </div>
      {isNew ? (
        <>
          <div className="form-row">
            <div className="form-group col-md-6">
              <label htmlFor={id('name')}>Full name</label>
              <input id={id('name')} className="form-control" autoComplete="off" value={traveller.fullName} onChange={set('fullName')} />
            </div>
            <div className="form-group col-md-6">
              <label htmlFor={id('email')}>Email</label>
              <input id={id('email')} type="email" className="form-control" autoComplete="off" value={traveller.email} onChange={set('email')} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group col-md-6">
              <label htmlFor={id('passport')}>Passport no.</label>
              <input id={id('passport')} className="form-control" autoComplete="off" value={traveller.passport} onChange={set('passport')} />
            </div>
            <div className="form-group col-md-6">
              <label htmlFor={id('phone')}>Mobile (optional)</label>
              <input id={id('phone')} type="tel" className="form-control" autoComplete="off" value={traveller.phone} onChange={set('phone')} />
            </div>
          </div>
        </>
      ) : (
        <div className="form-group">
          <label htmlFor={id('existing')}>Passenger</label>
          <select id={id('existing')} className="form-control" value={traveller.passengerId} onChange={set('passengerId')}>
            <option value="">Select a passenger…</option>
            {passengers.map((p) => <option key={p.passengerId} value={p.passengerId}>{p.fullName} ({p.passengerId})</option>)}
          </select>
        </div>
      )}
      {error && <div className="text-danger small" role="alert">{error}</div>}
    </div>
  );
}

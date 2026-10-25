import React, { useEffect, useRef, useState } from 'react';
import { airportLabel, getAirport, searchAirports } from '../domain/airports';

/**
 * Airport picker with suggestions as you type (city, airport name, code or country) - the Django project's
 * "places" autocomplete, as an accessible combobox: arrow keys move, Enter chooses, Escape closes.
 *
 * `value` is an airport code ('' = nothing chosen). `codes` limits the suggestions to those airports.
 */
export default function AirportInput({ id, label, value, onChange, codes = null, placeholder = 'City or airport', invalid = false }) {
  const [text, setText] = useState(value ? airportLabel(value) : '');
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [active, setActive] = useState(0);
  const emitted = useRef(value);            // the last value this component reported, so it can tell outside changes

  // Follow changes made from outside (the swap button, a popular-route shortcut).
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setText(value ? airportLabel(value) : '');
      setTyping(false);
    }
  }, [value]);

  const allowed = codes ? new Set([...codes].map((c) => String(c).toUpperCase())) : null;
  const results = open && typing ? searchAirports(text, { codes, limit: 8 }) : [];
  const listId = `${id}-list`;

  function choose(airport) {
    emitted.current = airport.code;
    onChange(airport.code);
    setText(airportLabel(airport.code));
    setTyping(false);
    setOpen(false);
  }

  function handleChange(e) {
    setText(e.target.value);
    setTyping(true);
    setOpen(true);
    setActive(0);
    if (value) {
      emitted.current = '';
      onChange('');
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && results[active]) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  function handleBlur() {
    setOpen(false);
    // Typing a full code such as "lhr" and tabbing away counts as choosing it.
    const exact = getAirport(text.trim());
    if (!value && typing && exact && (!allowed || allowed.has(exact.code))) choose(exact);
  }

  return (
    <div className="airport-input">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={`form-control${invalid ? ' is-invalid' : ''}`}
        type="text"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${id}-option-${results[active].code}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={(e) => e.target.select()}
        onBlur={handleBlur}
      />
      <ul id={listId} role="listbox" className="airport-list" hidden={!(open && results.length > 0)}>
        {results.map((airport, index) => (
          <li
            key={airport.code}
            id={`${id}-option-${airport.code}`}
            role="option"
            aria-selected={index === active}
            className={index === active ? 'active' : ''}
            onMouseDown={(e) => { e.preventDefault(); choose(airport); }}
            onMouseEnter={() => setActive(index)}
          >
            <strong>{airport.city}</strong> <span className="code">{airport.code}</span>
            <small>{airport.name} · {airport.country}</small>
          </li>
        ))}
      </ul>
      {open && typing && text.trim() !== '' && results.length === 0 && (
        <div className="airport-empty">No airports with flights match “{text.trim()}”.</div>
      )}
    </div>
  );
}

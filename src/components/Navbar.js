import React, { useState } from 'react';
import './navbar.css';
import { Link, NavLink } from 'react-router-dom';

const LINKS = [
  { to: '/', label: 'Search', end: true },
  { to: '/flights', label: 'Flights' },
  { to: '/bookings', label: 'List of Bookings' },
  { to: '/passengers', label: 'Passengers' },
  { to: '/admin', label: 'Manage' },
];

const Navbar = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="navigation-wrap bg-light start-header start-style">
      <div className="container">
        <div className="row">
          <div className="col-12">
            <nav className="navbar navbar-expand-md navbar-light">
              <Link className="navbar-brand" to="/">
                <h2>AirNest</h2>
              </Link>
              <button
                className="navbar-toggler"
                type="button"
                aria-label="Toggle navigation"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                <span className="navbar-toggler-icon" />
              </button>
              <div className={`collapse navbar-collapse${open ? ' show' : ''}`} id="navbarSupportedContent">
                <ul className="navbar-nav ml-auto py-4 py-md-0">
                  {LINKS.map(({ to, label, end }) => (
                    <li className="nav-item pl-4 pl-md-0 ml-0 ml-md-4" key={to}>
                      <NavLink
                        to={to}
                        end={end}
                        className={({ isActive }) => `nav-link${isActive ? ' active-link' : ''}`}
                        onClick={() => setOpen(false)}
                      >
                        {label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            </nav>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Navbar;

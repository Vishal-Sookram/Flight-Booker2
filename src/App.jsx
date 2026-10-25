import React from 'react';
import './App.css';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './components/Home';
import SearchResults from './components/SearchResults';
import Checkout from './components/Checkout';
import TripDetails from './components/TripDetails';
import FlightSearch from './components/FlightSearch';
import BookTicket from './components/BookTicket';
import ListBooking from './components/ListBooking';
import Passengers from './components/Passengers';
import ManageFlights from './components/ManageFlights';

/**
 * AirNest: every screen reads from the one shared BookingService (src/domain), so a booking made on
 * the seat map shows up immediately in the bookings list, the passenger's receipt and the flight search.
 */
export default function App() {
  return (
    <Router>
      <Navbar />
      <main className="page-wrap">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/trip/:reference" element={<TripDetails />} />
          <Route path="/flights" element={<FlightSearch />} />
          <Route path="/book/:flightId" element={<BookTicket />} />
          <Route path="/bookings" element={<ListBooking />} />
          <Route path="/passengers" element={<Passengers />} />
          <Route path="/admin" element={<ManageFlights />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </Router>
  );
}

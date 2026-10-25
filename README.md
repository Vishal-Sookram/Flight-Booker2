# AirNest – Flight Booking

A React flight-booking app: search a real airline schedule (one-way or return), pick seats on a visual seat map,
book for a whole group and pay (demo checkout), get a booking reference and a printable e-ticket, join a waitlist when
a flight is full, and track or cancel bookings. Early-bird pricing and First Class private suites are included.

The screens come from the original AirNest prototype; the business logic is a JavaScript port of the
SkyDesk Java/JavaFX lab (`flight_booking_v2`).

## Run
```
npm install
npm start        # http://localhost:3000
npm test         # 116 tests covering the domain layer
```
No backend is needed. Everything is saved in the browser's localStorage after every change.
Use **Manage → Reset demo data** to start again.

## Search and book a trip
1. **Search** (`/`): choose airports with the autocomplete (city, airport name, code or country), one way or return,
   cabin and number of passengers. 60 airports and about 12,800 weekly flights on 76 airlines are included.
2. **Results** (`/search`): filter by price, departure / arrival time of day and airline; sort by price, departure,
   duration or arrival; hop between nearby dates using the cheapest-fare-per-day strip. For a return trip you pick the
   outbound flight, then a return flight that leaves late enough after it lands.
3. **Checkout** (`/checkout`): passenger details (new or already registered) → seats for every passenger on every
   flight ("Seat us together" does it automatically) → payment.
4. **Trip** (`/trip/:reference`): the booking reference (e.g. `K7M2QX`), itinerary and fares. Print it as an
   e-ticket or cancel the whole trip. Look a booking up from the Search page or the bookings list.

Payment is a demo: no money moves and nothing about the card is stored. Use `4242 4242 4242 4242` (any future expiry,
any code); `4000 0000 0000 0002` is always declined. `MockPaymentGateway` (src/domain/payment.js) is the one place to
swap in a real provider.

## Flight data
The schedule and airport list come from the CSV files of the *Flight-Ticket-Booking* Django project. They needed
cleaning, so they are rebuilt by a script rather than used as-is:
```
node scripts/build-schedule.mjs <folder with airports.csv, domestic_flights.csv, international_flights.csv>
```
It writes `src/domain/airportData.js` and `src/data/schedule.json` (the generated files are committed, so you only
need the script to rebuild them). What it fixes, and prints counts for:
- **Corrupted flight numbers.** IndiGo's `6E155` had been turned into `6.00E+155` by a spreadsheet (416 rows).
- **Duplicate rows** for the same flight and weekday with different fares (220): the cheapest is kept.
- **Premium fares that cost less than the cabin below** (dropped; that cabin is then simply not sold on the flight).
- **Currency.** Fares are in rupees; they are converted at a fixed 110 rupees to the pound (`INR_PER_GBP` in the
  script). Treat prices as illustrative, not as real fares.
- **Flight time.** The CSV `duration` is the difference between the two local clock times (so New York to London
  showed as 12h 10m). The real elapsed time is recovered from airport time zones.
- A few misspelt city names (Naqpur, Changcha, ...).

Times are shown in local airport time, with daylight saving handled by the browser's time zone database. Each schedule
flight is only created in the booking system when somebody picks it; until then it is just a search result.
Flights are 15-85% full when first seen (the same every time, so results are stable), and about 1 in 30 is sold out.


## Business rules
- Prices are whole pence (no floating point). The fare is fixed when the booking is made.
- Early bird: 10% off when booked more than 60 days before departure.
- A flight is Scheduled, Boarding (last 60 minutes), Departed or Cancelled. Only Scheduled flights can be booked
  or waitlisted; departed flights can't be cancelled; check-in closes at departure.
- A passenger can hold one live booking per flight; passports are unique.
- A full flight puts new bookings on a waitlist; cancelling a seat promotes the first person waiting
  (priced at the time of promotion).
- First Class seats can take a private suite (+£200), which is cleared if the seat is freed.
- Cancelling a whole flight cancels every booking on it.
- Each flight can have its own fare per cabin; a cabin without a fare is not sold on that flight (most Indian domestic
  flights are economy only). A flight whose sold cabins are full counts as full.
- A flight has an `id` (unique per departure) separate from its flight number, because airlines fly the same number
  every day. For flights added by hand the id is the flight number.
- A reservation books several passengers on one or two flights all-or-nothing: everything is checked first and a
  failure leaves no trace. All its bookings share one booking reference. At most 9 passengers.

## Routes
`/` search · `/search` results · `/checkout` · `/trip/:reference` · `/flights` flights on file ·
`/book/:flightId` seat map + booking (single seat, waitlist) · `/bookings` list of bookings · `/passengers` · `/admin` manage flights

## Saved data
Saves made before this version still load: flights keep their number as their id, and old bookings are given
references the first time they are opened.

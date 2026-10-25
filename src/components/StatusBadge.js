import React from 'react';
import { FlightStatus } from '../domain/flight';
import { BookingStatus } from '../domain/booking';

const FLIGHT_STYLE = {
  [FlightStatus.SCHEDULED.name]: 'success',
  [FlightStatus.BOARDING.name]: 'warning',
  [FlightStatus.DEPARTED.name]: 'secondary',
  [FlightStatus.CANCELLED.name]: 'danger',
};

const BOOKING_STYLE = {
  [BookingStatus.CONFIRMED]: 'success',
  [BookingStatus.CHECKED_IN]: 'info',
  [BookingStatus.WAITLISTED]: 'warning',
  [BookingStatus.CANCELLED]: 'secondary',
};

const BOOKING_LABEL = {
  [BookingStatus.CONFIRMED]: 'Confirmed',
  [BookingStatus.CHECKED_IN]: 'Checked in',
  [BookingStatus.WAITLISTED]: 'Waitlisted',
  [BookingStatus.CANCELLED]: 'Cancelled',
};

export function FlightStatusBadge({ status }) {
  return <span className={`badge badge-${FLIGHT_STYLE[status.name]}`}>{status.label}</span>;
}

export function BookingStatusBadge({ status }) {
  return <span className={`badge badge-${BOOKING_STYLE[status]}`}>{BOOKING_LABEL[status]}</span>;
}

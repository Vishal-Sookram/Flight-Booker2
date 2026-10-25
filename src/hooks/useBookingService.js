import { useEffect, useState, useSyncExternalStore } from 'react';
import { bookingService } from '../services/bookingServiceInstance';

/**
 * Gives a component the shared BookingService and re-renders it whenever the data changes
 * (the Observer pattern from the lab) - and every 30 seconds, so flight statuses such as
 * "Boarding" and "Departed" stay current while a page is open.
 */
export function useBookingService() {
  useSyncExternalStore(bookingService.subscribe, bookingService.getVersion);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);
  return bookingService;
}

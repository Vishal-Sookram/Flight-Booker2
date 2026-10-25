import { BookingService } from '../domain/bookingService';

/** localStorage if the browser allows it (it can be blocked, e.g. in private windows), otherwise null. */
function browserStorage() {
  try {
    const probe = '__airnest_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

/** The one BookingService the whole app shares (the Singleton from the lab, as a module-level constant). */
export const bookingService = new BookingService({ storage: browserStorage() });

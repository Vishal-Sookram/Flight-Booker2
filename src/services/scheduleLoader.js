import { ScheduleCatalog } from '../domain/schedule';

let loading = null;

/**
 * Loads the flight schedule once. It is about 600 KB, so it is a separate download (webpack splits it out of the
 * main bundle because of import()) and only fetched when a screen needs it.
 */
export function loadScheduleCatalog() {
  if (!loading) {
    loading = import('../data/schedule.json')
      .then((module) => new ScheduleCatalog(module.default ?? module))
      .catch((error) => {
        loading = null;                       // allow another try on the next visit
        throw error;
      });
  }
  return loading;
}

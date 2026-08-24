import { mount } from './app/mount';

/**
 * The standalone page: one instance, in the one element `index.html` provides.
 *
 * This file used to be `src/index.ts` and constructed a `PlivetApp` - the page
 * and the application were the same thing. They are separate now: the entry
 * point is a class anyone can construct, and this is a caller of it.
 *
 * What the page asked for, before anything is built: the theme it opens in,
 * the features it leaves out and the canvas sections it starts with are all
 * decided by the configuration element rather than switched afterwards, so a
 * reader never sees a panel appear and then go again. A page with no
 * configuration element gets an empty one, which is c-visualizer as it comes.
 *
 * The finding and the mounting are `app/mount.ts`, shared with the deployed
 * bundle `src/embed.ts` builds, so both pages look for the same elements and
 * read the same configuration. This page's `#root` is the older of the two
 * names and is still what `index.html` writes.
 */
mount();

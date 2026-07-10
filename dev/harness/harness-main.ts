// Harness entry point (loaded by dev/harness/index.html).
//
// The real game entry (game.ts) is imported for its side effect: it registers a
// DOMContentLoaded listener that boots Phaser + the HUD. Because ES module
// imports evaluate BEFORE this module's body — and DOMContentLoaded only fires
// after all deferred module scripts finish — game.ts's listener is registered in
// time, and the mock interceptor below is installed before that listener ever
// runs its first `store.refresh()`. (A dynamic import would resolve too late and
// miss DOMContentLoaded entirely, leaving the canvas blank.)

import '../../src/client/game.css';
import { installMockApi } from './mock-api';
import { mountDevPanel } from './dev-panel';
import '../../src/client/game';

installMockApi();
mountDevPanel();

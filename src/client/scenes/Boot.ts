import { Scene } from 'phaser';

/**
 * Nothing to load before the Preloader (which streams the Kenney sprite atlas with
 * a progress bar), so Boot simply hands off.
 */
export class Boot extends Scene {
  constructor() {
    super('Boot');
  }

  create() {
    this.scene.start('Preloader');
  }
}

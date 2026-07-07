import { Scene } from 'phaser';

/**
 * The village renders entirely from runtime-generated pixel textures (see
 * `src/client/art`), so there are no external assets to preload here. Boot
 * simply hands off to the Preloader, which registers those textures.
 */
export class Boot extends Scene {
  constructor() {
    super('Boot');
  }

  create() {
    this.scene.start('Preloader');
  }
}

import { Scene } from 'phaser';
import { PAL } from '../../shared/palette';
import { registerBuildings } from '../art/buildings';
import { registerLandmark } from '../art/landmark';
import { registerTiles } from '../art/tiles';

/**
 * Registers the whole runtime pixel-art factory into the shared TextureManager
 * (tiles, every building × tier, icons, and the landmark stages) then starts the
 * village. Textures persist on the game's TextureManager, so the Village scene
 * can reference them by key.
 */
export class Preloader extends Scene {
  constructor() {
    super('Preloader');
  }

  create() {
    this.cameras.main.setBackgroundColor(PAL.night);
    registerTiles(this);
    registerBuildings(this);
    registerLandmark(this);
    this.scene.start('Village');
  }
}

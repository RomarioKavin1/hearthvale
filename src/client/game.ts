import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { PAL } from '../shared/palette';
import { ArtDebug } from './scenes/ArtDebug';
import { Boot } from './scenes/Boot';
import { Preloader } from './scenes/Preloader';
import { Village } from './scenes/Village';
import { initHud } from './ui/hud';

// Dev-only art verification surface, opt-in via the `?artdebug` query string.
const ART_DEBUG =
  typeof location !== 'undefined' && location.search.includes('artdebug');

const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  backgroundColor: PAL.night,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1024,
    height: 768,
  },
  scene: ART_DEBUG
    ? [ArtDebug, Boot, Preloader, Village]
    : [Boot, Preloader, Village],
};

const StartGame = (parent: string): Game => {
  return new Game({ ...config, parent });
};

document.addEventListener('DOMContentLoaded', () => {
  const game = StartGame('game-container');
  initHud(game);
});

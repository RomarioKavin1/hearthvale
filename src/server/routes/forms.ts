import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { doVillageSettings, OpError } from '../core/village';
import { villageDisplayName } from '../../shared/catalog';

export const forms = new Hono();

/** Form field values submitted by the villageSettings form. `theme` arrives as
 * a single-element array (Devvit select fields submit string arrays). */
type VillageSettingsValues = {
  villageName?: unknown;
  theme?: unknown;
  crest?: unknown;
  crestColor?: unknown;
};

/** First entry of a select field's array value (or the raw value as a fallback). */
const firstOf = (value: unknown): unknown =>
  Array.isArray(value) ? value[0] : value;

/** Devvit select values arrive as strings; the crest fields are numeric indices. */
const asIndex = (value: unknown): number | undefined => {
  const first = firstOf(value);
  if (typeof first !== 'string') return undefined;
  const n = Number(first);
  return Number.isInteger(n) ? n : undefined;
};

/**
 * Persist the moderator's village name + theme choice, then confirm with a
 * toast. The core helper validates the name and broadcasts the fresh city so
 * open clients rename/retheme live.
 */
forms.post('/village-settings', async (c) => {
  try {
    const body = await c.req.json<VillageSettingsValues>();
    const city = await doVillageSettings(
      body.villageName,
      firstOf(body.theme),
      asIndex(body.crest),
      asIndex(body.crestColor)
    );
    return c.json<UiResponse>(
      { showToast: `Saved — welcome to ${villageDisplayName(city.villageName)}` },
      200
    );
  } catch (error) {
    if (error instanceof OpError) {
      return c.json<UiResponse>({ showToast: error.message }, 200);
    }
    console.error(`Error saving village settings: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to save village settings' }, 400);
  }
});

import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';
import { getCity } from '../core/store';
import {
  CREST_COLORS,
  CREST_EMBLEMS,
  MAX_VILLAGE_NAME,
  THEME_LABELS,
  VILLAGE_THEMES,
} from '../../shared/catalog';

export const menu = new Hono();

/**
 * Moderator "Village settings" menu action: opens the villageSettings form
 * pre-filled with the current name + theme. The submit handler lives in
 * routes/forms.ts (mounted under /internal/form).
 */
menu.post('/village-settings', async (c) => {
  try {
    const city = await getCity();
    return c.json<UiResponse>(
      {
        showForm: {
          name: 'villageSettings',
          form: {
            title: 'Village settings',
            description:
              'Name your subreddit’s village and pick a colour theme. Both show up for everyone.',
            acceptLabel: 'Save',
            fields: [
              {
                type: 'string',
                name: 'villageName',
                label: `Village name (up to ${MAX_VILLAGE_NAME} characters — leave blank for "Hearthvale")`,
                defaultValue: city.villageName,
              },
              {
                type: 'select',
                name: 'theme',
                label: 'Theme',
                options: VILLAGE_THEMES.map((t) => ({
                  label: THEME_LABELS[t],
                  value: t,
                })),
                defaultValue: [city.theme],
              },
              {
                type: 'select',
                name: 'crest',
                label: 'Crest emblem (flies as a pennant on the Village Hall)',
                options: CREST_EMBLEMS.map((e, i) => ({
                  label: e.label,
                  value: String(i),
                })),
                defaultValue: [String(city.crest)],
              },
              {
                type: 'select',
                name: 'crestColor',
                label: 'Crest banner colour',
                options: CREST_COLORS.map((cc, i) => ({
                  label: cc.label,
                  value: String(i),
                })),
                defaultValue: [String(city.crestColor)],
              },
            ],
          },
        },
      },
      200
    );
  } catch (error) {
    console.error(`Error opening village settings: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to open village settings' }, 400);
  }
});

menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();

    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>(
      {
        showToast: 'Failed to create post',
      },
      400
    );
  }
});

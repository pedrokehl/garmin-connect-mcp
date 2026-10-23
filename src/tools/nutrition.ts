import { z } from 'zod';
import { seg } from '../garmin/client.js';
import { jsonTool } from './define.js';
import { date, integer } from './schemas.js';

export const getNutritionLog = jsonTool({
  name: 'garmin_get_nutrition_log',
  title: 'Get nutrition / food log (one day)',
  endpoint: 'GET /nutrition-service/food/logs/{date}',
  description:
    "Get the user's food log for one day from Garmin Connect nutrition tracking: daily nutrition goals, totals of calories and nutrients consumed " +
    '(protein, carbs, fat, fiber…), logged foods with serving sizes, and meal-by-meal details (breakfast, lunch, dinner, snacks). ' +
    'Only has data if the user logs food in Garmin Connect.',
  inputSchema: z.object({
    date: date('The day to fetch.'),
    includeGoals: z.boolean().nullish().describe('Include nutrition goals. Default true.'),
    includeNutrition: z.boolean().nullish().describe('Include nutrient totals. Default true.'),
    includeMedia: z.boolean().nullish().describe('Include food images. Default true; set false to keep the response smaller.'),
    mealId: integer().nullish().describe('Only return one meal (breakfast, lunch, dinner or snacks) by its numeric meal ID, as seen in mealDetails.'),
  }),
  request: ({ date, ...query }) => ({ path: `/nutrition-service/food/logs/${seg(date)}`, query }),
});

export const nutritionTools = [getNutritionLog];

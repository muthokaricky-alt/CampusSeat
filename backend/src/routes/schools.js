import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();
router.get('/', asyncHandler(async (_req, res) => {
  res.json({ schools: await query('SELECT school_id, school_name FROM schools ORDER BY school_name') });
}));
export default router;

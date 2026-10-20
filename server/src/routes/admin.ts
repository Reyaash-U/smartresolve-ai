import { Router } from 'express';
import { Department, User } from '../models';
import { eligibleWorkloads } from '../services/routing';
import { analyticsHandler } from './analytics';
import { requireAuth, requireRole } from '../middleware/auth';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

// Same figures as GET /analytics, restricted to admins (all departments, optional ?department= filter).
adminRouter.get('/analytics', analyticsHandler);

// Staff roster for assignment screens. Never exposes password hashes (select:false on the model).
adminRouter.get('/users', async (_req, res, next) => {
  try {
    const depts = await Department.find().lean();
    const users = await User.find({ role: { $in: ['staff', 'admin'] } }).select('displayName email role departmentId active').lean();
    // Current active workload per staff member (ASSIGNED + IN_PROGRESS) helps admins reassign sensibly.
    const load = new Map<string, number>();
    for (const d of depts) for (const w of await eligibleWorkloads(d._id)) load.set(w.staffId, w.active);
    res.json({
      users: users.map((u) => ({ ...u, department: depts.find((d) => String(d._id) === String(u.departmentId))?.name ?? null, activeWorkload: load.get(String(u._id)) ?? 0 })),
    });
  } catch (e) {
    next(e);
  }
});

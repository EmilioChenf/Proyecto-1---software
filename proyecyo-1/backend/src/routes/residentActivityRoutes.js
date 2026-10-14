const router = require('express').Router();
const { requireRoles } = require('../middlewares/requireRoles');
const activity = require('../services/residentActivityService');

router.get('/residente/actividad', requireRoles(['residente']), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await activity.list(req.authUser.id, req.query));
  } catch (error) { next(error); }
});
module.exports = router;

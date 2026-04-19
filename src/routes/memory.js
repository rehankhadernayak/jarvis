const express = require('express');
const router = express.Router();
const { db, setMemory, getMemory, getAllMemory } = require('../db/init');

router.get('/', (req, res) => res.json(getAllMemory()));
router.get('/:key', (req, res) => {
  const v = getMemory(req.params.key);
  if (v === null) return res.status(404).json({ error: 'not found' });
  res.json({ key: req.params.key, value: v });
});
router.post('/', (req, res) => {
  const { key, value } = req.body;
  setMemory(key, value);
  res.json({ ok: true });
});

module.exports = router;

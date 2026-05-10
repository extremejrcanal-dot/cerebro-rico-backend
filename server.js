const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const db = { query: (text, params) => pool.query(text, params) };

app.use(cors());
app.use(express.json());

function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token necessário' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    next();
  } catch {
    return res.status(403).json({ error: 'Token inválido' });
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Cérebro Rico 2.0 API is running' });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Email já cadastrado' });
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO users (email, password_hash, name, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id, email, name`,
      [email, passwordHash, name]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await db.query('SELECT id, email, name, password_hash FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Credenciais inválidas' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, name, level, total_xp, streak_days FROM users WHERE id = $1`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, name, level, total_xp, streak_days, monthly_income FROM users WHERE id = $1`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar perfil' });
  }
});

app.get('/api/goals', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM goals WHERE user_id = $1 ORDER BY priority DESC', [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar metas' });
  }
});

app.post('/api/goals', authenticateToken, async (req, res) => {
  try {
    const { title, description, target_amount, deadline, priority = 1 } = req.body;
    const result = await db.query(
      `INSERT INTO goals (user_id, title, description, target_amount, deadline, priority, status) VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING *`,
      [req.user.id, title, description, target_amount, deadline, priority]
    );
    res.json({ goal: result.rows[0], message: `Meta "${title}" criada com sucesso! 🎯` });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar meta' });
  }
});

app.get('/api/finance/transactions', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC LIMIT 100', [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar transações' });
  }
});

app.get('/api/finance/health', authenticateToken, async (req, res) => {
  try {
    const tx = await db.query(
      `SELECT type, SUM(amount) as total FROM transactions WHERE user_id = $1 AND date >= date_trunc('month', CURRENT_DATE) GROUP BY type`,
      [req.user.id]
    );
    let income = 0, expenses = 0;
    for (const row of tx.rows) {
      if (row.type === 'income') income += parseFloat(row.total);
      else expenses += parseFloat(row.total);
    }
    const balance = income - expenses;
    res.json({ income, expenses, balance, savings_rate: income > 0 ? ((balance/income)*100).toFixed(1)+'%' : '0%' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao analisar finanças' });
  }
});

app.get('/api/routine/daily-plan', authenticateToken, async (req, res) => {
  const plan = {
    date: new Date().toISOString().split('T')[0],
    blocks: [
      { time: '06:00-07:00', activity: 'Manhã poderosa' },
      { time: '07:00-12:00', activity: 'Foco profundo' },
      { time: '12:00-13:00', activity: 'Almoço e descanso' },
      { time: '13:00-17:00', activity: 'Tarefas operacionais' },
      { time: '17:00-18:00', activity: 'Revisão do dia' },
      { time: '18:00-22:00', activity: 'Família, lazer e desenvolvimento' }
    ]
  };
  res.json(plan);
});

app.post('/api/ai/apollo/motivation', authenticateToken, (req, res) => {
  const frases = ['Você está mais perto do que imagina! 🚀','Consistência é o segredo! 💪','Cada real poupado é liberdade amanhã! 🌟'];
  res.json({ motivation: frases[Math.floor(Math.random() * frases.length)] });
});

app.get('/api/analytics/overview', authenticateToken, (req, res) => res.json({ message: 'Em breve!' }));
app.get('/api/calendar/events', authenticateToken, (req, res) => res.json({ message: 'Em breve!' }));

app.listen(PORT, () => {
  console.log(`🚀 Cérebro Rico 2.0 API running on port ${PORT}`);
  console.log(`🧠 AI Agents initialized`);
});

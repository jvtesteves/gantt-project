const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// PostgreSQL Connection Pool
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: connectionString,
});

// Configure CORS for production
const allowedOrigins = process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : ['http://localhost:3000']; // Default to localhost for development

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  }
}));

// --- API Endpoints ---

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM users');
    res.json(result.rows.map(row => row.name));
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get all tasks
app.get('/api/tasks', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, start_date AS start, due_date AS end, progress, color, custom_class, owner FROM tasks');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching tasks:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create a new task
app.post('/api/tasks', async (req, res) => {
  const { name, start, end, progress, color, custom_class, owner } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO tasks (name, start_date, due_date, progress, color, custom_class, owner) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [name, start, end, progress || 0, color || '#0288d1', custom_class, owner]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update a task
app.put('/api/tasks/:id', async (req, res) => {
  const taskId = req.params.id;
  const { name, start, end, progress, color, custom_class, owner, currentUser } = req.body; // Get currentUser from request body

  try {
    // First, check if the task exists and belongs to the currentUser
    const taskCheck = await pool.query('SELECT owner FROM tasks WHERE id = $1', [taskId]);
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }
    if (taskCheck.rows[0].owner !== currentUser) {
      return res.status(403).json({ message: 'Você não tem permissão para editar esta tarefa.' });
    }

    // If authorized, proceed with update
    const result = await pool.query(
      'UPDATE tasks SET name = $1, start_date = $2, due_date = $3, progress = $4, color = $5, custom_class = $6, owner = $7 WHERE id = $8 RETURNING *',
      [name, start, end, progress, color, custom_class, owner, taskId]
    );
    if (result.rows.length === 0) {
      // This case should ideally not be reached if taskCheck passed, but as a fallback
      return res.status(404).json({ message: 'Task not found after check.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating task:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete a task
app.delete('/api/tasks/:id', async (req, res) => {
  const taskId = req.params.id;
  const { currentUser } = req.body; // Get currentUser from request body

  try {
    // First, check if the task exists and belongs to the currentUser
    const taskCheck = await pool.query('SELECT owner FROM tasks WHERE id = $1', [taskId]);
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }
    if (taskCheck.rows[0].owner !== currentUser) {
      return res.status(403).json({ message: 'Você não tem permissão para excluir esta tarefa.' });
    }

    // If authorized, proceed with deletion
    const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING id', [taskId]);
    if (result.rows.length === 0) {
      // This case should ideally not be reached if taskCheck passed, but as a fallback
      return res.status(404).json({ message: 'Task not found after check.' });
    }
    res.status(204).send(); // No Content
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
const express = require('express');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Get all tasks from all users (for team view)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    
    // Get all tasks with user information
    const tasksResult = await db.query(`
      SELECT t.id, t.name, t.start_date, t.end_date, t.progress, t.dependencies, 
             t.created_at, t.updated_at, u.full_name, u.username
      FROM tasks t
      JOIN users u ON t.user_id = u.id
      ORDER BY t.start_date ASC, u.full_name ASC
    `);

    const tasks = tasksResult.rows.map(task => ({
      id: task.id,
      name: task.name,
      start: task.start_date.toISOString().split('T')[0], // Format as YYYY-MM-DD
      end: task.end_date.toISOString().split('T')[0],
      progress: task.progress,
      dependencies: task.dependencies,
      owner: task.full_name || task.username, // Add owner field for frontend compatibility
      createdAt: task.created_at,
      updatedAt: task.updated_at
    }));

    res.json(tasks);
  } catch (error) {
    console.error('Error fetching all tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Get all tasks for a user
router.get('/:username', optionalAuth, async (req, res) => {
  try {
    const { username } = req.params;
    const db = req.app.locals.db;

    // Find user by username or full name (for backward compatibility)
    const userResult = await db.query(`
      SELECT id FROM users 
      WHERE username = $1 OR full_name = $1
    `, [username]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Get tasks for the user
    const tasksResult = await db.query(`
      SELECT t.id, t.name, t.start_date, t.end_date, t.progress, t.dependencies, 
             t.created_at, t.updated_at, u.full_name, u.username
      FROM tasks t
      JOIN users u ON t.user_id = u.id
      WHERE t.user_id = $1
      ORDER BY t.start_date ASC
    `, [userId]);

    const tasks = tasksResult.rows.map(task => ({
      id: task.id,
      name: task.name,
      start: task.start_date.toISOString().split('T')[0], // Format as YYYY-MM-DD
      end: task.end_date.toISOString().split('T')[0],
      progress: task.progress,
      dependencies: task.dependencies,
      owner: task.full_name || task.username, // Add owner field for frontend compatibility
      createdAt: task.created_at,
      updatedAt: task.updated_at
    }));

    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Create a new task
router.post('/:username', optionalAuth, async (req, res) => {
  try {
    const { username } = req.params;
    const { name, start, end, progress = 0, dependencies = '' } = req.body;
    const db = req.app.locals.db;

    // Validate required fields
    if (!name || !start || !end) {
      return res.status(400).json({ error: 'Name, start date, and end date are required' });
    }

    // Find user
    const userResult = await db.query(`
      SELECT id FROM users 
      WHERE username = $1 OR full_name = $1
    `, [username]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Allow task creation without authentication for backward compatibility

    // Create task
    const result = await db.query(`
      INSERT INTO tasks (user_id, name, start_date, end_date, progress, dependencies)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, start_date, end_date, progress, dependencies, created_at, updated_at
    `, [userId, name, start, end, progress, dependencies]);

    const task = result.rows[0];

    res.status(201).json({
      message: 'Task created successfully',
      task: {
        id: task.id,
        name: task.name,
        start: task.start_date.toISOString().split('T')[0],
        end: task.end_date.toISOString().split('T')[0],
        progress: task.progress,
        dependencies: task.dependencies,
        createdAt: task.created_at,
        updatedAt: task.updated_at
      }
    });
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Update a task
router.put('/:username/:taskId', optionalAuth, async (req, res) => {
  try {
    const { username, taskId } = req.params;
    const { name, start, end, progress, dependencies } = req.body;
    const db = req.app.locals.db;

    // Find user
    const userResult = await db.query(`
      SELECT id FROM users 
      WHERE username = $1 OR full_name = $1
    `, [username]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    if (start) {
      updates.push(`start_date = $${paramCount}`);
      values.push(start);
      paramCount++;
    }

    if (end) {
      updates.push(`end_date = $${paramCount}`);
      values.push(end);
      paramCount++;
    }

    if (progress !== undefined) {
      updates.push(`progress = $${paramCount}`);
      values.push(progress);
      paramCount++;
    }

    if (dependencies !== undefined) {
      updates.push(`dependencies = $${paramCount}`);
      values.push(dependencies);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(userId, taskId);

    const result = await db.query(`
      UPDATE tasks 
      SET ${updates.join(', ')}
      WHERE user_id = $${paramCount} AND id = $${paramCount + 1}
      RETURNING id, name, start_date, end_date, progress, dependencies, created_at, updated_at
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = result.rows[0];

    res.json({
      message: 'Task updated successfully',
      task: {
        id: task.id,
        name: task.name,
        start: task.start_date.toISOString().split('T')[0],
        end: task.end_date.toISOString().split('T')[0],
        progress: task.progress,
        dependencies: task.dependencies,
        createdAt: task.created_at,
        updatedAt: task.updated_at
      }
    });
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Delete a task
router.delete('/:username/:taskId', optionalAuth, async (req, res) => {
  try {
    const { username, taskId } = req.params;
    const db = req.app.locals.db;

    // Find user
    const userResult = await db.query(`
      SELECT id FROM users 
      WHERE username = $1 OR full_name = $1
    `, [username]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Delete task
    const result = await db.query(`
      DELETE FROM tasks 
      WHERE user_id = $1 AND id = $2
      RETURNING id, name
    `, [userId, taskId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({
      message: 'Task deleted successfully',
      deletedTask: {
        id: result.rows[0].id,
        name: result.rows[0].name
      }
    });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

module.exports = router;
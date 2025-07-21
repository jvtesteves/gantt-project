// Database initialization and helper functions

const initDatabase = async (pool) => {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create tasks table with user association
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        progress INTEGER DEFAULT 0,
        dependencies TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
    `);

    // Create default admin user if it doesn't exist
    const adminExists = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      ['admin']
    );

    if (adminExists.rows.length === 0) {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('admin123', 12);
      
      await pool.query(`
        INSERT INTO users (username, email, password_hash, full_name)
        VALUES ($1, $2, $3, $4)
      `, ['admin', 'admin@ganttproject.com', hashedPassword, 'Administrator']);
      
      console.log('✅ Default admin user created (username: admin, password: admin123)');
    }

    // Migrate old data if exists
    const oldUsersExist = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'users_old'
      )
    `);

    if (!oldUsersExist.rows[0].exists) {
      // Check if we have old user data to migrate
      const oldUsers = ['João Victor', 'João Gabriel', 'Victor Moreno', 'Kaique Breno', 'Lucas Queiroz'];
      
      for (const userName of oldUsers) {
        const userExists = await pool.query(
          'SELECT id FROM users WHERE full_name = $1',
          [userName]
        );

        if (userExists.rows.length === 0) {
          const bcrypt = require('bcryptjs');
          const username = userName.toLowerCase().replace(/\s+/g, '');
          const email = `${username}@ganttproject.com`;
          const hashedPassword = await bcrypt.hash('123456', 12);
          
          await pool.query(`
            INSERT INTO users (username, email, password_hash, full_name)
            VALUES ($1, $2, $3, $4)
          `, [username, email, hashedPassword, userName]);
        }
      }
      
      console.log('✅ Migrated existing users to new auth system');
    }

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
};

const executeQuery = async (pool, query, params = []) => {
  const client = await pool.connect();
  try {
    const result = await client.query(query, params);
    return result;
  } finally {
    client.release();
  }
};

module.exports = {
  initDatabase,
  executeQuery
};
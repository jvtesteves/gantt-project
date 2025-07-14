-- Create the table for tasks
CREATE TABLE tasks (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name TEXT NOT NULL,
  start_date DATE NOT NULL, -- Renamed from 'start' to 'start_date'
  due_date DATE NOT NULL,   -- Renamed from 'end' to 'due_date'
  progress INT DEFAULT 0,
  color VARCHAR(7) DEFAULT '#0288d1',
  custom_class TEXT,
  owner TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert the users into a new 'users' table
CREATE TABLE users (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name TEXT NOT NULL UNIQUE
);

INSERT INTO users (name) VALUES
('João Victor'),
('João Gabriel'),
('Victor Moreno'),
('Kaique Breno'),
('Lucas Queiroz');

-- Enable Row Level Security (RLS) for the tables
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create policies to allow public read access
CREATE POLICY "Public read access for tasks" ON tasks FOR SELECT USING (true);
CREATE POLICY "Public read access for users" ON users FOR SELECT USING (true);

-- Create policies to allow users to insert, update, and delete their own tasks
CREATE POLICY "Allow individual insert access" ON tasks FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow individual update access" ON tasks FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow individual delete access" ON tasks FOR DELETE USING (true);

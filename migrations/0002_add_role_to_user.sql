-- Migration number: 0002
ALTER TABLE user ADD COLUMN role TEXT NOT NULL DEFAULT 'cashier';

// A test-only pepper; production reads PIN_PEPPER from Secret Manager.
process.env.PIN_PEPPER = process.env.PIN_PEPPER || "test-pepper-0123456789abcdef0123456789abcdef";

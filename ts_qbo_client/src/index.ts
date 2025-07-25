
// index.ts
// Main entry point for QBO integration server. Sets up Express routes for QuickBooks authentication and API endpoints.
import express, { Express, Request, Response, RequestHandler } from 'express'; // Express web framework
import dotenv from 'dotenv'; // Loads environment variables from .env file
import { QuickBooksAuth } from './auth'; // Handles QuickBooks OAuth logic
import { frappe } from './frappe'; // Frappe API integration
import { QuickBooksSettings } from './types'; // Type definitions for QuickBooks settings
import { fromFrappe, toFrappe } from './sync/mappers'; // Data mapping utilities
import { createCustomerInQbo } from './createCustomerInQbo'; // Function to create customer in QBO
import cron from 'node-cron'; // For scheduled tasks (not used in this file)
import axios from 'axios'; // HTTP client (not used in this file)

dotenv.config(); // Initialize environment variables

const app: Express = express(); // Create Express app
app.use(express.json()); // Parse JSON request bodies
const port = process.env.PORT || 3000; // Server port

// Route to initiate QuickBooks OAuth authentication
app.get('/auth/qbo', async (req, res) => {
  try {
    // Fetch QuickBooks settings from Frappe
    const raw = await frappe.getDoc<QuickBooksSettings>('QuickBooks Settings', 'QuickBooks Settings');
    const settings = fromFrappe(raw);
    // Create QuickBooksAuth instance and get auth URL
    const qbo = new QuickBooksAuth(settings);
    const authUrl = await qbo.initiateAuth();
    res.redirect(authUrl); // Redirect user to QuickBooks login
  } catch (error) {
    console.error('Error initiating auth:', error);
    res.status(500).send('Could not start QuickBooks login.');
  }
});

// Callback route for QuickBooks OAuth (after user logs in)
app.get('/auth/qbo/callback', async (req: Request, res: Response): Promise<void> => {
  // Extract query parameters from QuickBooks redirect
  const code = req.query.code as string;
  const realmId = req.query.realmId as string;
  const state = req.query.state as string;

  if (!code || !realmId) {
    res.status(400).send('Missing required query parameters');
    return;
  }

  try {
    // Fetch QuickBooks settings and handle OAuth callback
    const settings = await frappe.getDoc<QuickBooksSettings>('QuickBooks Settings', 'QuickBooks Settings');
    const qbo = new QuickBooksAuth(settings);
    const start = Date.now(); // For timing/debugging (not used)
    await qbo.handleCallback(code, realmId, state);
    res.send('QuickBooks connected successfully!');
  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).send('Failed to connect to QuickBooks.');
  }
});
// API route to create a customer in QuickBooks Online
app.post('/api/handle-customer-create', async (req: Request, res: Response) => {
  // Extract customer_name from request body
  const { customer_name } = req.body as { customer_name?: string };

  if (typeof customer_name !== 'string') {
    res.status(400).send('❌ Missing or invalid customer_name');
    return;
  }

  try {
    // Call function to create customer in QBO
    const result = await createCustomerInQbo(customer_name);
    res.json(result); // Return result as JSON
  } catch (error: any) {
    console.error(`❌ Error creating customer '${customer_name}':`, error.message || error);
    res.status(500).send('❌ Failed to create customer in QBO');
  }
});

// Start Express server
app.listen(port, () => {
  console.log(`QBO integration server running at http://localhost:${port}`);
});






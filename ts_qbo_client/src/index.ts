
// index.ts
import express, { Express, Request, Response, RequestHandler } from 'express';
import dotenv from 'dotenv';
import { QuickBooksAuth } from './auth';
import { frappe } from './frappe';
import { QuickBooksSettings } from './types';
import { fromFrappe, toFrappe } from './sync/mappers'; 
import { createCustomerInQbo } from './createCustomerInQbo'; // ensure this is already at the top
import cron from 'node-cron';
import axios from 'axios';

dotenv.config();

const app: Express = express();
app.use(express.json());
const port = process.env.PORT || 3000;

app.get('/auth/qbo', async (req, res) => {
  try {
    const raw = await frappe.getDoc<QuickBooksSettings>('QuickBooks Settings', 'QuickBooks Settings');
    const settings = fromFrappe(raw);
    const qbo = new QuickBooksAuth(settings);
    const authUrl = await qbo.initiateAuth();
    res.redirect(authUrl);
  } catch (error) {
    console.error('Error initiating auth:', error);
    res.status(500).send('Could not start QuickBooks login.');
  }
});

app.get('/auth/qbo/callback', async (req: Request, res: Response): Promise<void> => {
  const code = req.query.code as string;
  const realmId = req.query.realmId as string;
  const state = req.query.state as string;

  if (!code || !realmId) {
    res.status(400).send('Missing required query parameters');
    return;
  }

  try {
    const settings = await frappe.getDoc<QuickBooksSettings>('QuickBooks Settings', 'QuickBooks Settings');
    const qbo = new QuickBooksAuth(settings);
    const start = Date.now();
    await qbo.handleCallback(code, realmId, state);
    res.send('QuickBooks connected successfully!');
  
  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).send('Failed to connect to QuickBooks.');
  }
});
// Customer creation route (line 54)
app.post('/api/handle-customer-create', async (req: Request, res: Response) => {
  const { customer_name } = req.body as { customer_name?: string };

  if (typeof customer_name !== 'string') {
    res.status(400).send('❌ Missing or invalid customer_name');
    return;
  }

  try {
    const result = await createCustomerInQbo(customer_name);
    res.json(result);
  } catch (error: any) {
    console.error(`❌ Error creating customer '${customer_name}':`, error.message || error);
    res.status(500).send('❌ Failed to create customer in QBO');
  }
});

app.listen(port, () => {
  console.log(`QBO integration server running at http://localhost:${port}`);
});






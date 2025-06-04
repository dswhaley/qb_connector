import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
import { QuickBooksAuth } from './auth';
import { frappe } from './frappe';
import { QuickBooksSettings } from './types';
import { fromFrappe, toFrappe } from './mappers';
import cron from 'node-cron';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;

app.get('/auth/qbo', async (req, res) => {
  try {
    const raw = await frappe.getDoc<QuickBooksSettings>('QuickBooks Settings');
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
    const settings = await frappe.getDoc<QuickBooksSettings>('QuickBooks Settings');
    const qbo = new QuickBooksAuth(settings);
    await qbo.handleCallback(code, realmId, state);
    res.send('QuickBooks connected successfully!');
  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).send('Failed to connect to QuickBooks.');
  }
});

app.listen(port, () => {
  console.log(`QBO integration server running at http://localhost:${port}`);
});

cron.schedule('0 * * * *', async () => {
  console.log('🔁 Running hourly QBO token refresh...');

    try {
    const raw = await frappe.getDoc<QuickBooksSettings>('QuickBooks Settings');
    const settings = fromFrappe(raw);
    const qbo = new QuickBooksAuth(settings);
    await qbo.refreshToken();
    console.log('✅ Token refreshed successfully');
  } catch (err) {
    console.error('❌ Token refresh failed:', err);
  }
});
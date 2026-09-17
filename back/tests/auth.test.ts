import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './helpers/client';
import { env } from '../src/config/env';

describe('Authentification', () => {
  it('refuse un mauvais mot de passe', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: env.auth.username, password: 'mauvais-mot-de-passe' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('IDENTIFIANTS_INVALIDES');
  });

  it('refuse un identifiant inconnu', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'inconnu', password: env.auth.password });

    expect(res.status).toBe(401);
  });

  it('refuse une requête sans identifiant/mot de passe', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('REQUETE_INVALIDE');
  });

  it('accepte les bons identifiants et pose un cookie de session', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: env.auth.username, password: env.auth.password });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authentifie: true });
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('/me ne renvoie jamais 401, même sans session', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authentifie: false });
  });

  it('/me confirme la session une fois connecté', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: env.auth.username, password: env.auth.password });

    const res = await agent.get('/api/auth/me');
    expect(res.body).toEqual({ authentifie: true });
  });

  it('bloque les routes protégées sans session', async () => {
    const res = await request(app).get('/api/metiers');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NON_AUTHENTIFIE');
  });

  it('logout supprime la session : les routes protégées redeviennent inaccessibles', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: env.auth.username, password: env.auth.password });
    await agent.get('/api/metiers').expect(200);

    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/metiers').expect(401);
  });

  it('la route santé reste publique', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

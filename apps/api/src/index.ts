import express, { Request, Response } from 'express';
import { oauthRouter } from './routes.oauth';
import { cohortRouter } from './routes.cohort';
import { restoreRouter } from './routes.restore';
import { verifyRouter } from './routes.verify';

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

// 요청 로깅(디버그용)
app.use((req, _res, next) => {
  console.log(`[API] ${req.method} ${req.url}`);
  next();
});

// 헬스체크
app.get('/health', (_req: Request, res: Response) => res.send('ok'));
app.get('/', (_req: Request, res: Response) => res.send('Restoration API running'));

// ⬇️ 라우터는 "루트"에 그대로 장착
app.use(oauthRouter);
app.use(cohortRouter);
app.use(restoreRouter);
app.use(verifyRouter);

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, '0.0.0.0', () => console.log(`✅ API listening on ${PORT}`));

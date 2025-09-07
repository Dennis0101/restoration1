// apps/api/src/index.ts
import express, { Request, Response } from 'express';
import { oauthRouter } from './routes.oauth';
import { cohortRouter } from './routes.cohort';
import { restoreRouter } from './routes.restore';
import { verifyRouter } from './routes.verify';

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

// 헬스체크(배포 상태 확인용)
app.get('/health', (_req: Request, res: Response) => res.send('ok'));
app.get('/', (_req: Request, res: Response) => res.send('Restoration API running'));

// ⚠️ 라우터를 루트에 그대로 장착 (각 라우터 내부가 '/cohort', '/restore/:key' 등을 가짐)
app.use(oauthRouter);
app.use(cohortRouter);
app.use(restoreRouter);
app.use(verifyRouter);

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => console.log(`✅ API listening on ${PORT}`));

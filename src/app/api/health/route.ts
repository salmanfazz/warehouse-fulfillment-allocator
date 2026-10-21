import { checkDatabase } from '@/http/database';
import { notAllowed } from '@/http/methods';
import { withEnvelope } from '@/http/withEnvelope';

export const dynamic = 'force-dynamic';

export const GET = withEnvelope(() => checkDatabase());

export const { POST, PUT, PATCH, DELETE, OPTIONS } = notAllowed('GET');

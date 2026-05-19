import redis from 'ioredis';
import config from '../../config';

const redisClient = new redis(config.redis.url);
export default redisClient;

redisClient.on('connect', () => {
    console.log('Connected to Redis');
});

redisClient.on('error', (err) => {
    console.error('Redis connection error:', err);
});

redisClient.on('end', () => {
    console.log('Redis connection closed');
});
import './styles.css';
import { mountApp } from './app/shell';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element.');
mountApp(root);

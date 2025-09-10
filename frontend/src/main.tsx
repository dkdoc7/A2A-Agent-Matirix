import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import SniffApp from './SniffApp'

const params = new URLSearchParams(window.location.search)
const isSniff = params.get('sniff') === '1'
ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		{isSniff ? <SniffApp /> : <App />}
	</React.StrictMode>
)
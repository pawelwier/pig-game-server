import http from 'http'
import WS from 'websocket'
import * as dotenv from 'dotenv'
import { getPlayerById, updatePlayerScore } from '../api/player/playerService.js'
import { getGameById, restartGame, rollNumber, setGameState, updateCurrentPlayerId, updateCurrentScore } from '../api/game/gameService.js'
import { getNextPlayerId } from '../api/game/gameHelpers.js'
import { handleRequests } from '../api/requestHandler.js'
import { GameState } from '../db/models/Game.js'

dotenv.config()

const WebSocketServer = WS.server

const port = process.env.PORT || process.env.SERVER_PORT

export const MessageTypes = {
  ADD: 'add',
  TAKE: 'take',
  RESTART: 'restart',
}

/* websocket */
const webSocketServer = http.createServer(handleRequests)

const originIsAllowed = origin => {
  // TODO: add conditions
  return true;
}
export const webSocketConnect = () => {
  const wsServer = new WebSocketServer({
    httpServer: webSocketServer,
    autoAcceptConnections: false
  })

  wsServer.on('connect', webSocketConnection => {
    webSocketServer.getConnections((err, count) => { console.log('count', count) })
  })
  
  wsServer.on('request', req => {
    if (!originIsAllowed(req.origin)) {
      req.reject()
      console.log((new Date()) + ` Connection from origin ${req.origin} rejected.`)
      return
    }
    
    const connection = req.accept('pig-game-protocol', req.origin)
    console.log((new Date()) + ' Connection accepted.')
    
    connection.on('message', async message => {
      const data = JSON.parse(message.utf8Data)
      const { type, gameId } = data
      const game = await getGameById({ gameId })

      // TODO: move out, refactor
      if (type === MessageTypes.ADD) { 
        const { points } = data
        const rollResponse = await rollNumber({ gameId, points })

        wsServer.connections.forEach(conn => {
          conn.sendUTF(JSON.stringify({ ...rollResponse, type }))
        })
        return
      }
      else if (type === MessageTypes.TAKE) {
        const { currentPlayer, currentScore, options: { target } } = game
        const player = await getPlayerById({ playerId: currentPlayer })
        const opponentId = getNextPlayerId({ game })
      
        await updatePlayerScore({ playerId: player._id,  score: currentScore, increase: true })
        await updateCurrentScore({ gameId, score: 0 })
        
        const isWinner = (player.score + currentScore) >= target
        console.log('points', player.score, currentScore, target)
        console.log('isWinner', isWinner)
        if (isWinner) {
          await setGameState({ gameId, state: GameState.FINISHED })
        } else {
          await updateCurrentPlayerId({ gameId, playerId: opponentId })
        }

        wsServer.connections.forEach(conn => {
          conn.sendUTF(JSON.stringify({ 
            currentPlayer: isWinner ? currentPlayer : opponentId,
            isWinner,
            type 
          }))
        })
      }
      else if (type === MessageTypes.RESTART) {
        const opponentId = getNextPlayerId({ game })
        await restartGame({ gameId, currentPlayer: opponentId })
        wsServer.connections.forEach(conn => {
          conn.sendUTF(JSON.stringify({ 
            currentPlayer: opponentId,
            type 
          }))
        })
      }
    })

    connection.on('close', (reasonCode, description) => {
      console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.')
    })
  })
  
  try {
    webSocketServer.listen(port, () => {
      console.log(new Date() + ' WS Server is listening on port, ', port)
    })
  } catch(err) {
    console.log('error', err?.code)
    console.log(err)
  }
}
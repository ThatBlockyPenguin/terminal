import { Client } from "./client.ts";
import { EventHandler } from "./eventhandler.ts";
import { acceptWebSocket, isWebSocketCloseEvent } from "../deps.ts";
/**
 * Class that handles WebSocket messages.
 * Uses Client objects and an EventHandler object
 * to send messages to Clients.
*/ export class Sono {
    server = null;
    hostname = 'localhost';
    clients = {
    };
    channelsList = {
        'home': {
        }
    };
    eventHandler;
    lastClientId = 1000;
    /**
   * Constructor creates a new instance of the Event,
   * binds handleWs to this and returns a Sono instance.
   */ constructor(){
        this.eventHandler = new EventHandler();
        this.handleWs = this.handleWs.bind(this);
    }
    // /**
    //  * Start server listening on passed-in port number.
    //  * @param {number} port - Port that Sono.server listens to.
    //  */
    // listen(port: number): DenoServer {
    //   const options: HTTPOptions = {port};
    //   this.server = serve(options);
    //   this.awaitRequests(this.server);
    //   return this.server;
    // }
    /**
   * Adding a channel to channelsList object
   * @param { name } - name of channel
   */ channel(name, callback) {
        this.channelsList[name] = {
        };
        callback();
        return;
    }
    // /**
    //  * awaitRequests handles requests to server and returns undefined
    //  * @param { DenoServer } - Sono.server from which requests are sent from
    //  */
    // async awaitRequests(server: DenoServer):Promise<void> {
    //   // iterate over async request objects to server
    //   for await(const req of server) {
    //     this.handler(req);
    //   }
    // }
    connect(req, callback) {
        const { conn , w: bufWriter , r: bufReader , headers  } = req;
        acceptWebSocket({
            conn,
            bufWriter,
            bufReader,
            headers
        }).then(this.handleWs).catch((err)=>console.log(err, 'err')
        );
        callback();
    }
    emit(message) {
        Object.values(this.clients).forEach((client)=>{
            client.socket.send(JSON.stringify({
                message
            }));
        });
    }
    /**
   * handleWS method handles a socket connection
   * Instantiants a new client
   * Events of socket are looped thru and dealt with accordingly
   * @param { WebSocket } - WebSocket connection from a client
   */ async handleWs(socket) {
        // create new client, add to clients object, add client to home channel
        const client = new Client(socket, this.lastClientId);
        this.lastClientId = client.id;
        this.clients[client.id] = client;
        this.channelsList['home'][client.id] = client;
        for await (const message of socket){
            // if client sends close websocket event, delete client
            if (isWebSocketCloseEvent(message) || typeof message !== 'string') {
                delete this.channelsList[client.channel][client.id];
                delete this.clients[client.id];
                break;
            }
            const data = JSON.parse(message);
            // const event = new Event(data.protocol)
            // const grab = data.payload.message;
            // depending on data.protocol, invoke an eventHandler method
            switch(data.protocol){
                case 'message':
                    // console.log('case message', this.clients)
                    this.eventHandler.handleMessage(data, client, this.channelsList);
                    break;
                case 'broadcast':
                    this.eventHandler.broadcast(data, client, this.channelsList);
                    break;
                case 'changeChannel':
                    this.channelsList = this.eventHandler.changeChannel(data, client, this.channelsList);
                    break;
                case 'directmessage':
                    this.eventHandler.directMessage(data, client, this.clients);
                    break;
                case 'grab':
                    this.eventHandler.grab(data, client, this.clients, this.channelsList);
                    break;
                default:
                    // this.eventHandler
                    // console.log('default hit', data)
                    console.log('default case in testServer');
            }
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3gvc29ub0B2MS4xL3NyYy9zZXJ2ZXIudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2xpZW50IH0gZnJvbSBcIi4vY2xpZW50LnRzXCI7XG5pbXBvcnQgeyBFdmVudEhhbmRsZXIgfSBmcm9tIFwiLi9ldmVudGhhbmRsZXIudHNcIjtcbmltcG9ydCB7IFBhY2tldCB9IGZyb20gXCIuL3BhY2tldC50c1wiO1xuaW1wb3J0IHR5cGUgeyBXZWJTb2NrZXQgfSBmcm9tIFwiLi4vZGVwcy50c1wiO1xuaW1wb3J0IHR5cGUgeyBIVFRQT3B0aW9ucyB9IGZyb20gXCIuLi9kZXBzLnRzXCI7XG5pbXBvcnQgeyBzZXJ2ZSwgRGVub1NlcnZlciwgU2VydmVyUmVxdWVzdCwgc2VydmVGaWxlLCBhY2NlcHRXZWJTb2NrZXQsIGlzV2ViU29ja2V0Q2xvc2VFdmVudCB9IGZyb20gXCIuLi9kZXBzLnRzXCI7XG4vKipcbiAqIENsYXNzIHRoYXQgaGFuZGxlcyBXZWJTb2NrZXQgbWVzc2FnZXMuXG4gKiBVc2VzIENsaWVudCBvYmplY3RzIGFuZCBhbiBFdmVudEhhbmRsZXIgb2JqZWN0XG4gKiB0byBzZW5kIG1lc3NhZ2VzIHRvIENsaWVudHMuXG4qL1xuXG5leHBvcnQgY2xhc3MgU29ubyB7XG4gIHB1YmxpYyBzZXJ2ZXI6IERlbm9TZXJ2ZXIgfCBudWxsID0gbnVsbDtcbiAgcHVibGljIGhvc3RuYW1lID0gJ2xvY2FsaG9zdCc7XG4gIHB1YmxpYyBjbGllbnRzOiB7W2tleTogc3RyaW5nXTogQ2xpZW50fSA9IHt9O1xuICBwdWJsaWMgY2hhbm5lbHNMaXN0OiB7W2tleTogc3RyaW5nXTogUmVjb3JkPHN0cmluZywgQ2xpZW50Pn0gPSB7J2hvbWUnOiB7fX07XG4gIHB1YmxpYyBldmVudEhhbmRsZXI6IEV2ZW50SGFuZGxlcjtcbiAgcHVibGljIGxhc3RDbGllbnRJZDogbnVtYmVyID0gMTAwMDtcblxuICAvKipcbiAgICogQ29uc3RydWN0b3IgY3JlYXRlcyBhIG5ldyBpbnN0YW5jZSBvZiB0aGUgRXZlbnQsXG4gICAqIGJpbmRzIGhhbmRsZVdzIHRvIHRoaXMgYW5kIHJldHVybnMgYSBTb25vIGluc3RhbmNlLlxuICAgKi9cbiAgY29uc3RydWN0b3IoKSB7XG5cbiAgICB0aGlzLmV2ZW50SGFuZGxlciA9IG5ldyBFdmVudEhhbmRsZXIoKTtcbiAgICB0aGlzLmhhbmRsZVdzID0gdGhpcy5oYW5kbGVXcy5iaW5kKHRoaXMpO1xuICB9XG5cbiAgLy8gLyoqXG4gIC8vICAqIFN0YXJ0IHNlcnZlciBsaXN0ZW5pbmcgb24gcGFzc2VkLWluIHBvcnQgbnVtYmVyLlxuICAvLyAgKiBAcGFyYW0ge251bWJlcn0gcG9ydCAtIFBvcnQgdGhhdCBTb25vLnNlcnZlciBsaXN0ZW5zIHRvLlxuICAvLyAgKi9cbiAgLy8gbGlzdGVuKHBvcnQ6IG51bWJlcik6IERlbm9TZXJ2ZXIge1xuICAvLyAgIGNvbnN0IG9wdGlvbnM6IEhUVFBPcHRpb25zID0ge3BvcnR9O1xuICAvLyAgIHRoaXMuc2VydmVyID0gc2VydmUob3B0aW9ucyk7XG4gIC8vICAgdGhpcy5hd2FpdFJlcXVlc3RzKHRoaXMuc2VydmVyKTtcbiAgLy8gICByZXR1cm4gdGhpcy5zZXJ2ZXI7XG4gIC8vIH1cblxuICAvKipcbiAgICogQWRkaW5nIGEgY2hhbm5lbCB0byBjaGFubmVsc0xpc3Qgb2JqZWN0XG4gICAqIEBwYXJhbSB7IG5hbWUgfSAtIG5hbWUgb2YgY2hhbm5lbFxuICAgKi9cbiAgY2hhbm5lbChuYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiAoKSA9PiB2b2lkKSA6dm9pZCB7XG4gICAgdGhpcy5jaGFubmVsc0xpc3RbbmFtZV0gPSB7fTtcblxuICAgIGNhbGxiYWNrKCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gLyoqXG4gIC8vICAqIGF3YWl0UmVxdWVzdHMgaGFuZGxlcyByZXF1ZXN0cyB0byBzZXJ2ZXIgYW5kIHJldHVybnMgdW5kZWZpbmVkXG4gIC8vICAqIEBwYXJhbSB7IERlbm9TZXJ2ZXIgfSAtIFNvbm8uc2VydmVyIGZyb20gd2hpY2ggcmVxdWVzdHMgYXJlIHNlbnQgZnJvbVxuICAvLyAgKi9cbiAgLy8gYXN5bmMgYXdhaXRSZXF1ZXN0cyhzZXJ2ZXI6IERlbm9TZXJ2ZXIpOlByb21pc2U8dm9pZD4ge1xuICAvLyAgIC8vIGl0ZXJhdGUgb3ZlciBhc3luYyByZXF1ZXN0IG9iamVjdHMgdG8gc2VydmVyXG4gIC8vICAgZm9yIGF3YWl0KGNvbnN0IHJlcSBvZiBzZXJ2ZXIpIHtcbiAgLy8gICAgIHRoaXMuaGFuZGxlcihyZXEpO1xuICAvLyAgIH1cbiAgLy8gfVxuXG5cblxuXG4gIGNvbm5lY3QocmVxOiBTZXJ2ZXJSZXF1ZXN0LCBjYWxsYmFjazogKCkgPT4gdm9pZCl7XG4gICAgY29uc3QgeyBjb25uLCB3OmJ1ZldyaXRlciwgcjpidWZSZWFkZXIsIGhlYWRlcnMgfSA9IHJlcTtcbiAgICBhY2NlcHRXZWJTb2NrZXQoe2Nvbm4sIGJ1ZldyaXRlciwgYnVmUmVhZGVyLCBoZWFkZXJzfSlcbiAgICAgIC50aGVuKHRoaXMuaGFuZGxlV3MpXG4gICAgICAuY2F0Y2goZXJyID0+IGNvbnNvbGUubG9nKGVyciwgJ2VycicpKVxuICAgIGNhbGxiYWNrKCk7XG4gIH1cblxuXG5cbiAgZW1pdChtZXNzYWdlOiBzdHJpbmcpe1xuICAgIE9iamVjdC52YWx1ZXModGhpcy5jbGllbnRzKS5mb3JFYWNoKGNsaWVudCA9PiB7XG4gICAgICBjbGllbnQuc29ja2V0LnNlbmQoSlNPTi5zdHJpbmdpZnkoe21lc3NhZ2V9KSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIGhhbmRsZVdTIG1ldGhvZCBoYW5kbGVzIGEgc29ja2V0IGNvbm5lY3Rpb25cbiAgICogSW5zdGFudGlhbnRzIGEgbmV3IGNsaWVudFxuICAgKiBFdmVudHMgb2Ygc29ja2V0IGFyZSBsb29wZWQgdGhydSBhbmQgZGVhbHQgd2l0aCBhY2NvcmRpbmdseVxuICAgKiBAcGFyYW0geyBXZWJTb2NrZXQgfSAtIFdlYlNvY2tldCBjb25uZWN0aW9uIGZyb20gYSBjbGllbnRcbiAgICovXG4gIGFzeW5jIGhhbmRsZVdzIChzb2NrZXQ6IFdlYlNvY2tldCk6UHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gY3JlYXRlIG5ldyBjbGllbnQsIGFkZCB0byBjbGllbnRzIG9iamVjdCwgYWRkIGNsaWVudCB0byBob21lIGNoYW5uZWxcblxuICAgIGNvbnN0IGNsaWVudCA9IG5ldyBDbGllbnQoc29ja2V0LCB0aGlzLmxhc3RDbGllbnRJZCk7XG4gICAgdGhpcy5sYXN0Q2xpZW50SWQgPSBjbGllbnQuaWRcbiAgICB0aGlzLmNsaWVudHNbY2xpZW50LmlkXSA9IGNsaWVudDtcbiAgICB0aGlzLmNoYW5uZWxzTGlzdFsnaG9tZSddW2NsaWVudC5pZF0gPSBjbGllbnQ7XG5cbiAgICBmb3IgYXdhaXQoY29uc3QgbWVzc2FnZSBvZiBzb2NrZXQpe1xuICAgICAgLy8gaWYgY2xpZW50IHNlbmRzIGNsb3NlIHdlYnNvY2tldCBldmVudCwgZGVsZXRlIGNsaWVudFxuICAgICAgaWYgKGlzV2ViU29ja2V0Q2xvc2VFdmVudChtZXNzYWdlKSB8fCB0eXBlb2YgbWVzc2FnZSAhPT0gJ3N0cmluZycpe1xuICAgICAgICBkZWxldGUgdGhpcy5jaGFubmVsc0xpc3RbY2xpZW50LmNoYW5uZWxdW2NsaWVudC5pZF07XG4gICAgICAgIGRlbGV0ZSB0aGlzLmNsaWVudHNbY2xpZW50LmlkXVxuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNvbnN0IGRhdGE6IFBhY2tldCA9IEpTT04ucGFyc2UobWVzc2FnZSlcbiAgICAgIC8vIGNvbnN0IGV2ZW50ID0gbmV3IEV2ZW50KGRhdGEucHJvdG9jb2wpXG4gICAgICAvLyBjb25zdCBncmFiID0gZGF0YS5wYXlsb2FkLm1lc3NhZ2U7XG5cbiAgICAgIC8vIGRlcGVuZGluZyBvbiBkYXRhLnByb3RvY29sLCBpbnZva2UgYW4gZXZlbnRIYW5kbGVyIG1ldGhvZFxuICAgICAgc3dpdGNoKGRhdGEucHJvdG9jb2wpIHtcbiAgICAgICAgY2FzZSAnbWVzc2FnZSc6XG4gICAgICAgICAgLy8gY29uc29sZS5sb2coJ2Nhc2UgbWVzc2FnZScsIHRoaXMuY2xpZW50cylcbiAgICAgICAgICB0aGlzLmV2ZW50SGFuZGxlci5oYW5kbGVNZXNzYWdlKGRhdGEsIGNsaWVudCwgdGhpcy5jaGFubmVsc0xpc3QpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdicm9hZGNhc3QnOlxuICAgICAgICAgIHRoaXMuZXZlbnRIYW5kbGVyLmJyb2FkY2FzdChkYXRhLCBjbGllbnQsIHRoaXMuY2hhbm5lbHNMaXN0KVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdjaGFuZ2VDaGFubmVsJzpcbiAgICAgICAgICB0aGlzLmNoYW5uZWxzTGlzdCA9IHRoaXMuZXZlbnRIYW5kbGVyLmNoYW5nZUNoYW5uZWwoZGF0YSwgY2xpZW50LCB0aGlzLmNoYW5uZWxzTGlzdCk7XG4gICAgICAgICAgLy8gY29uc29sZS5sb2coJ2Nhc2UgY2hhbm5lbCcsIHRoaXMuY2hhbm5lbHNMaXN0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnZGlyZWN0bWVzc2FnZSc6XG4gICAgICAgICAgdGhpcy5ldmVudEhhbmRsZXIuZGlyZWN0TWVzc2FnZShkYXRhLCBjbGllbnQsIHRoaXMuY2xpZW50cyk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ2dyYWInOlxuICAgICAgICAgIHRoaXMuZXZlbnRIYW5kbGVyLmdyYWIoZGF0YSwgY2xpZW50LCB0aGlzLmNsaWVudHMsIHRoaXMuY2hhbm5lbHNMaXN0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAvLyB0aGlzLmV2ZW50SGFuZGxlclxuICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdkZWZhdWx0IGhpdCcsIGRhdGEpXG4gICAgICAgICAgY29uc29sZS5sb2coJ2RlZmF1bHQgY2FzZSBpbiB0ZXN0U2Vy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
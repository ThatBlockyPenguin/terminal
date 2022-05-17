/**
 * Class with static methods that handles messages from WebSocket connections.
 */ export class EventHandler {
    constructor(){
        return;
    }
    /**
   * Sends a message to each Client object in the same channel as client
   * @param { Packet } packet - Message received from client
   * @param { Client } client - Client sending message packet
   * @param { [key: string]: Record<string, Client> } channelsList - Object containing all channels in Sono server
   */ handleMessage(packet, client, channelsList) {
        const { message  } = packet.payload;
        const currentClientId = client.id.toString(); //1001
        const channelName = client.channel;
        const ids = Object.keys(channelsList[channelName]);
        ids.forEach((id)=>{
            channelsList[channelName][id].socket.send(JSON.stringify({
                protocol: packet.event,
                payload: {
                    message,
                    from: currentClientId
                }
            }));
        });
    }
    /**
   * Changes the channel client is in
   * @param { Packet } packet - Message containing channel to change client to
   * @param { Client } client - Client to change channel
   * @param { [key: string]: Record<string, Client> } channelsList - Object containing all channels in Sono server
   */ changeChannel(packet, client, channelsList) {
        const { to  } = packet.payload;
        const channel = client.channel;
        delete channelsList[channel][client.id];
        client.channel = to;
        channelsList[to][client.id] = client;
        return channelsList;
    }
    /**
   * Broadcast data to all clients except for the cliet sending the data
   * @param { Packet } packet - Message containing channel to change client to
   * @param { Client } client - Client to change channel
   * @param { [key: string]: Record<string, Client> } channelsList - Object containing all channels in Sono server
   */ broadcast(packet, client, channelsList) {
        const { message  } = packet.payload;
        const channelName = client.channel; //'home'
        const currentClientId = client.id.toString(); //1001
        const ids = Object.keys(channelsList[channelName]);
        ids.forEach((id)=>{
            console.log('broadcasting', id, 'channelsList', channelsList);
            if (id !== currentClientId) channelsList[channelName][id].socket.send(JSON.stringify({
                protocol: packet.event,
                payload: {
                    message,
                    from: currentClientId
                }
            }));
        });
    }
    /**
   * Direct messages to a specific client
   * @param { Packet } packet - Message containing channel to change client to
   * @param { Client } client - Client to change channel
   * @param { [key: string]: Record<string, Client> } clients - Object containing all channels in Sono server
   */ directMessage(packet, client, clients) {
        const { message , to  } = packet.payload;
        const currentClientId = client.id;
        // console.log(clients)
        Object.values(clients).forEach((client)=>{
            if (client.id.toString() == to.toString()) {
                client.socket.send(JSON.stringify({
                    protocol: packet.event,
                    payload: {
                        message,
                        from: currentClientId
                    }
                }));
            }
        });
    }
    /**
   * Provides the list of clients that are connected to the server
   * @param packet - Message containing channel to change client to
   * @param client
   * @param clients
   */ grab(packet, client, clients, channelsList) {
        const currentClientId = client.id.toString();
        const results = [];
        const { message  } = packet.payload;
        if (message === 'myid') {
            results.push(currentClientId);
        } else if (message === 'clients') {
            Object.keys(clients).forEach((clientId)=>{
                results.push(clientId);
            });
        } else if (message === 'channels') {
            Object.keys(channelsList).forEach((channel)=>{
                results.push(channel);
            });
        } else if (message === 'mychannelclients') {
            // console.log('channelsList', channelsList)
            Object.keys(channelsList[client.channel]).forEach((id)=>{
                results.push(id);
            });
        // Object.keys(channelsList).forEach(channel => {
        //   results.push(channel);
        // });
        } else if (message === 'mychannel') {
            results.push(client.channel);
        } else {
            results.push('invalid grab request');
        }
        client.socket.send(JSON.stringify({
            protocol: packet.event,
            payload: {
                message: results,
                type: message
            }
        }));
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vZGVuby5sYW5kL3gvc29ub0B2MS4xL3NyYy9ldmVudGhhbmRsZXIudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2xpZW50IH0gZnJvbSBcIi4vY2xpZW50LnRzXCJcbmltcG9ydCB7IFBhY2tldCB9IGZyb20gXCIuL3BhY2tldC50c1wiXG5cbi8qKlxuICogQ2xhc3Mgd2l0aCBzdGF0aWMgbWV0aG9kcyB0aGF0IGhhbmRsZXMgbWVzc2FnZXMgZnJvbSBXZWJTb2NrZXQgY29ubmVjdGlvbnMuXG4gKi9cbmV4cG9ydCBjbGFzcyBFdmVudEhhbmRsZXIge1xuICBjb25zdHJ1Y3Rvcigpe1xuICAgIHJldHVybjtcbiAgfVxuICAvKipcbiAgICogU2VuZHMgYSBtZXNzYWdlIHRvIGVhY2ggQ2xpZW50IG9iamVjdCBpbiB0aGUgc2FtZSBjaGFubmVsIGFzIGNsaWVudFxuICAgKiBAcGFyYW0geyBQYWNrZXQgfSBwYWNrZXQgLSBNZXNzYWdlIHJlY2VpdmVkIGZyb20gY2xpZW50XG4gICAqIEBwYXJhbSB7IENsaWVudCB9IGNsaWVudCAtIENsaWVudCBzZW5kaW5nIG1lc3NhZ2UgcGFja2V0XG4gICAqIEBwYXJhbSB7IFtrZXk6IHN0cmluZ106IFJlY29yZDxzdHJpbmcsIENsaWVudD4gfSBjaGFubmVsc0xpc3QgLSBPYmplY3QgY29udGFpbmluZyBhbGwgY2hhbm5lbHMgaW4gU29ubyBzZXJ2ZXJcbiAgICovXG4gIGhhbmRsZU1lc3NhZ2UocGFja2V0OiBQYWNrZXQsIGNsaWVudDogQ2xpZW50LCBjaGFubmVsc0xpc3Q6IHtba2V5OiBzdHJpbmddOiBSZWNvcmQ8c3RyaW5nLCBDbGllbnQ+fSl7XG4gICAgY29uc3QgeyBtZXNzYWdlIH0gPSBwYWNrZXQucGF5bG9hZDtcbiAgICBjb25zdCBjdXJyZW50Q2xpZW50SWQgPSBjbGllbnQuaWQudG9TdHJpbmcoKTsgLy8xMDAxXG5cbiAgICBjb25zdCBjaGFubmVsTmFtZSA9IGNsaWVudC5jaGFubmVsO1xuICAgIGNvbnN0IGlkcyA9IE9iamVjdC5rZXlzKGNoYW5uZWxzTGlzdFtjaGFubmVsTmFtZV0pXG5cblxuICAgIGlkcy5mb3JFYWNoKChpZCk9PntcblxuICAgICAgY2hhbm5lbHNMaXN0W2NoYW5uZWxOYW1lXVtpZF0uc29ja2V0LnNlbmQoSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBwcm90b2NvbDogcGFja2V0LmV2ZW50LFxuICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICBmcm9tOiBjdXJyZW50Q2xpZW50SWRcbiAgICAgICAgfVxuICAgICAgfSkpO1xuICAgIH0pXG5cbiAgICB9XG5cblxuICAvKipcbiAgICogQ2hhbmdlcyB0aGUgY2hhbm5lbCBjbGllbnQgaXMgaW5cbiAgICogQHBhcmFtIHsgUGFja2V0IH0gcGFja2V0IC0gTWVzc2FnZSBjb250YWluaW5nIGNoYW5uZWwgdG8gY2hhbmdlIGNsaWVudCB0b1xuICAgKiBAcGFyYW0geyBDbGllbnQgfSBjbGllbnQgLSBDbGllbnQgdG8gY2hhbmdlIGNoYW5uZWxcbiAgICogQHBhcmFtIHsgW2tleTogc3RyaW5nXTogUmVjb3JkPHN0cmluZywgQ2xpZW50PiB9IGNoYW5uZWxzTGlzdCAtIE9iamVjdCBjb250YWluaW5nIGFsbCBjaGFubmVscyBpbiBTb25vIHNlcnZlclxuICAgKi9cbiAgY2hhbmdlQ2hhbm5lbChwYWNrZXQ6IFBhY2tldCwgY2xpZW50OiBDbGllbnQsIGNoYW5uZWxzTGlzdDoge1trZXk6IHN0cmluZ106IFJlY29yZDxzdHJpbmcsIENsaWVudD59KToge1trZXk6IHN0cmluZ106IFJlY29yZDxzdHJpbmcsIENsaWVudD59e1xuICAgIGNvbnN0IHsgdG8gfSA9IHBhY2tldC5wYXlsb2FkO1xuXG5cbiAgICBjb25zdCBjaGFubmVsID0gY2xpZW50LmNoYW5uZWw7XG5cbiAgICBkZWxldGUgY2hhbm5lbHNMaXN0W2NoYW5uZWxdW2NsaWVudC5pZF07XG4gICAgY2xpZW50LmNoYW5uZWwgPSB0bztcbiAgICBjaGFubmVsc0xpc3RbdG9dW2NsaWVudC5pZF0gPSBjbGllbnQ7XG4gICAgcmV0dXJuIGNoYW5uZWxzTGlzdDtcbiAgfVxuXG4gIC8qKlxuICAgKiBCcm9hZGNhc3QgZGF0YSB0byBhbGwgY2xpZW50cyBleGNlcHQgZm9yIHRoZSBjbGlldCBzZW5kaW5nIHRoZSBkYXRhXG4gICAqIEBwYXJhbSB7IFBhY2tldCB9IHBhY2tldCAtIE1lc3NhZ2UgY29udGFpbmluZyBjaGFubmVsIHRvIGNoYW5nZSBjbGllbnQgdG9cbiAgICogQHBhcmFtIHsgQ2xpZW50IH0gY2xpZW50IC0gQ2xpZW50IHRvIGNoYW5nZSBjaGFubmVsXG4gICAqIEBwYXJhbSB7IFtrZXk6IHN0cmluZ106IFJlY29yZDxzdHJpbmcsIENsaWVudD4gfSBjaGFubmVsc0xpc3QgLSBPYmplY3QgY29udGFpbmluZyBhbGwgY2hhbm5lbHMgaW4gU29ubyBzZXJ2ZXJcbiAgICovXG4gIGJyb2FkY2FzdChwYWNrZXQ6IFBhY2tldCwgY2xpZW50OiBDbGllbnQsIGNoYW5uZWxzTGlzdDoge1trZXk6IHN0cmluZ106IFJlY29yZDxzdHJpbmcsIENsaWVudD59KXtcbiAgICBjb25zdCB7IG1lc3NhZ2UgfSA9IHBhY2tldC5wYXlsb2FkO1xuICAgIGNvbnN0IGNoYW5uZWxOYW1lID0gY2xpZW50LmNoYW5uZWw7IC8vJ2hvbWUnXG4gICAgY29uc3QgY3VycmVudENsaWVudElkID0gY2xpZW50LmlkLnRvU3RyaW5nKCk7IC8vMTAwMVxuICAgIGNvbnN0IGlkcyA9IE9iamVjdC5rZXlzKGNoYW5uZWxzTGlzdFtjaGFubmVsTmFtZV0pO1xuICAgIGlkcy5mb3JFYWNoKChpZCk9PntcbiAgICAgIGNvbnNvbGUubG9nKCdicm9hZGNhc3RpbmcnLCBpZCwgJ2NoYW5uZWxzTGlzdCcsIGNoYW5uZWxzTGlzdClcbiAgICAgIGlmKGlkICE9PSBjdXJyZW50Q2xpZW50SWQpIGNoYW5uZWxzTGlzdFtjaGFubmVsTmFtZV1baWRdLnNvY2tldC5zZW5kKEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgcHJvdG9jb2w6IHBhY2tldC5ldmVudCxcbiAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgZnJvbTogY3VycmVudENsaWVudElkXG4gICAgICAgIH0sXG4gICAgICB9KSk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogRGlyZWN0IG1lc3NhZ2VzIHRvIGEgc3BlY2lmaWMgY2xpZW50XG4gICAqIEBwYXJhbSB7IFBhY2tldCB9IHBhY2tldCAtIE1lc3NhZ2UgY29udGFpbmluZyBjaGFubmVsIHRvIGNoYW5nZSBjbGllbnQgdG9cbiAgICogQHBhcmFtIHsgQ2xpZW50IH0gY2xpZW50IC0gQ2xpZW50IHRvIGNoYW5nZSBjaGFubmVsXG4gICAqIEBwYXJhbSB7IFtrZXk6IHN0cmluZ106IFJlY29yZDxzdHJpbmcsIENsaWVudD4gfSBjbGllbnRzIC0gT2JqZWN0IGNvbnRhaW5pbmcgYWxsIGNoYW5uZWxzIGluIFNvbm8gc2VydmVyXG4gICAqL1xuICBkaXJlY3RNZXNzYWdlKHBhY2tldDogUGFja2V0LCBjbGllbnQ6IENsaWVudCwgY2xpZW50czoge1trZXk6IHN0cmluZ106IENsaWVudH0pe1xuICAgIGNvbnN0IHsgbWVzc2FnZSwgdG8gfSA9IHBhY2tldC5wYXlsb2FkO1xuICAgIGNvbnN0IGN1cnJlbnRDbGllbnRJZCA9IGNsaWVudC5pZDtcbiAgICAvLyBjb25zb2xlLmxvZyhjbGllbnRzKVxuICAgIE9iamVjdC52YWx1ZXMoY2xpZW50cykuZm9yRWFjaChjbGllbnQgPT4ge1xuICAgICAgaWYoY2xpZW50LmlkLnRvU3RyaW5nKCkgPT0gdG8udG9TdHJpbmcoKSl7XG4gICAgICAgIGNsaWVudC5zb2NrZXQuc2VuZChKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgcHJvdG9jb2w6IHBhY2tldC5ldmVudCxcbiAgICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgZnJvbTogY3VycmVudENsaWVudElkXG4gICAgICAgICAgfSxcbiAgICAgICAgfSkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm92aWRlcyB0aGUgbGlzdCBvZiBjbGllbnRzIHRoYXQgYXJlIGNvbm5lY3RlZCB0byB0aGUgc2VydmVyXG4gICAqIEBwYXJhbSBwYWNrZXQgLSBNZXNzYWdlIGNvbnRhaW5pbmcgY2hhbm5lbCB0byBjaGFuZ2UgY2xpZW50IHRvXG4gICAqIEBwYXJhbSBjbGllbnRcbiAgICogQHBhcmFtIGNsaWVudHNcbiAgICovXG4gIGdyYWIocGFja2V0OiBQYWNrZXQsIGNsaWVudDogQ2xpZW50LCBjbGllbnRzOiB7W2tleTogc3RyaW5nXTogQ2xpZW50fSwgY2hhbm5lbHNMaXN0OiB7W2tleTogc3RyaW5nXTogUmVjb3JkPHN0cmluZywgQ2xpZW50Pn0pe1xuXG4gICAgY29uc3QgY3VycmVudENsaWVudElkID0gY2xpZW50LmlkLnRvU3RyaW5nKCk7XG4gICAgY29uc3QgcmVzdWx0czogQXJyYXk8c3RyaW5nPiA9IFtdO1xuXG4gICAgY29uc3QgeyBtZXNzYWdlIH0gPSBwYWNrZXQucGF5bG9hZDtcbiAgICBpZihtZXNzYWdlID09PSAnbXlpZCcpe1xuICAgICAgcmVzdWx0cy5wdXNoKGN1cnJlbnRDbGllbnRJZClcbiAgICB9XG4gICAgZWxzZSBpZihtZXNzYWdlID09PSAnY2xpZW50cycpe1xuICAgICAgT2JqZWN0LmtleXMoY2xpZW50cykuZm9yRWFjaChjbGllbnRJZCA9PiB7XG4gICAgICAgIHJlc3VsdHMucHVzaChjbGllbnRJZClcbiAgICAgIH0pXG4gICAgfVxuICAgIGVsc2UgaWYgKG1lc3NhZ2UgPT09ICdjaGFubmVscycpe1xuICAgICAgT2JqZWN0LmtleXMoY2hhbm5lbHNMaXN0KS5mb3JFYWNoKGNoYW5uZWwgPT4ge1xuICAgICAgICByZXN1bHRzLnB1c2goY2hhbm5lbCk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSBpZiAobWVzc2FnZSA9PT0gJ215Y2hhbm5lbGNsaWVudHMnKXtcbiAgICAgIC8vIGNvbnNvbGUubG9nKCdjaGFubmVsc0xpc3QnLCBjaGFubmVsc0xpc3QpXG4gICAgICBPYmplY3Qua2V5cyhjaGFubmVsc0xpc3RbY2xpZW50LmNoYW5uZWxdKS5mb3JFYWNoKGlkID0+IHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKGlkKVxuICAgICAgfSlcbiAgICAgIC8vIE9iamVjdC5rZXlzKGNoYW5uZWxzTGlzdCkuZm9yRWFjaChjaGFubmVsID0+IHtcbiAgICAgIC8vICAgcmVzdWx0cy5wdXNoKGNoYW5uZWwpO1xuICAgICAgLy8gfSk7XG4gICAgfVxuICAgIGVsc2UgaWYgKG1lc3NhZ2UgPT09ICdteWNoYW5uZWwnKXtcbiAgICAgIHJlc3VsdHMucHVzaChjbGllbnQuY2hhbm5lbClcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICByZXN1bHRzLnB1c2goJ2ludmFsaWQgZ3JhYiByZXF1ZXN0JylcbiAgICB9XG5cbiAgICBjbGllbnQuc29ja2V0LnNlbmQoSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgcHJvdG9jb2w6IHBhY2tldC5ldmVudCxcbiAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgbWVzc2FnZTogcmVzdWx0cyxcbiAgICAgICAgdHlwZTogbWVzc2FnZVxuICAgICAgfVxuICAgIH0pKVxuICB9XG59Il0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUdBLEVBRUcsQUFGSDs7Q0FFRyxBQUZILEVBRUcsQ0FDSCxNQUFNLE9BQU8sWUFBWTtpQkFDVixDQUFDO1FBQ1osTUFBTTtJQUNSLENBQUM7SUFDRCxFQUtHLEFBTEg7Ozs7O0dBS0csQUFMSCxFQUtHLENBQ0gsYUFBYSxDQUFDLE1BQWMsRUFBRSxNQUFjLEVBQUUsWUFBcUQsRUFBQyxDQUFDO1FBQ25HLEtBQUssQ0FBQyxDQUFDLENBQUMsT0FBTyxFQUFDLENBQUMsR0FBRyxNQUFNLENBQUMsT0FBTztRQUNsQyxLQUFLLENBQUMsZUFBZSxHQUFH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
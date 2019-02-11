const Web3 = require('web3');
const fs = require("fs");
const Tx = require('ethereumjs-tx');

//global params
var myAddress = '0xC14BbA1b6CC582BBB6B554a5c0821C619CFD42c4';
var privateKey = Buffer.from('099e8dc1316d838865648e3df3698e7a2037b6c81f270cc075a415b4a8ca6270', 'hex');
var bridge_main = "0xd7f697affabe8f888e0b42dc0e6eba262b073218";
var bridge_side = "0xd7f697affabe8f888e0b42dc0e6eba262b073218";
var main = 'ws://localhost:8546';
var side = 'ws://localhost:8548';
var contract_source = "./bin/BridgeMain.json"

const web3_main = new Web3.providers.WebsocketProvider(main);
const web3_side = new Web3.providers.WebsocketProvider(side);
const web3 = new Web3(web3_main);

// contracts json contains compiled bridge contract
let source = fs.readFileSync(contract_source);
let contract_json = JSON.parse(source);

let abi = contract_json.abi;

function sendAcceptMessage(web3_to, bridge_to) {
    web3.eth.setProvider(web3_to);
    let bridge_dest = web3.eth.Contract(abi, bridge_to);
    console.log("Accepting message");
    let abiData = bridge_dest.methods.acceptMessage(event.returnValues.sender, event.returnValues.recipient, event.returnValues.data).encodeABI();
    let nonce = await web3.eth.getTransactionCount(myAddress);
    const rawTx = {
        nonce: nonce,
        from: myAddress,
        data: abiData,
        gasPrice: '0x09184e72a000',
        gasLimit: '0x5AA710',
      };
    const tx = new Tx(rawTx);
    tx.sign(privateKey);
    let receipt = await web3.eth.sendSignedTransaction('0x' + tx.serialize().toString('hex'))
    return receipt.transactionHash, receipt.status;
}

function setEventListener(web3_from, bridge_from, web3_to, bridge_to) {
    web3.eth.setProvider(web3_from);
    let bridge = web3.eth.Contract(abi, bridge_from);
    let subscription = bridge.events.Message().on('data', (event) => {
        console.log("Event on " + web3_from);
        console.log("Data:", event.returnValues.data);
        console.log("From:", event.returnValues.sender);
        console.log("To:", event.returnValues.recipient);
        
        console.log(sendAcceptMessage(web3_to, bridge_to));
    });
    return subscription;
}

async function run() {
    console.log("Starting to listen for events");

    let subscription_main = setEventListener(web3_main, bridge_main, web3_side, bridge_side);
    let subscription_side = setEventListener(web3_side, bridge_side, web3_main, bridge_main);

    return subscription_main, subscription_side;
}
run();
/*
run().then(subscription => {
    //console.log('Press any key to exit');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', () => {
        subscription.unsubscribe((error, success) => {
            if (success) {
                console.log('Successfully unsubscribed!');
            }
        });
        process.exit.bind(process, 0);
    });
})
.catch(err => {
    console.log(err);
});
*/
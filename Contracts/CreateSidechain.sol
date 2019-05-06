/**
 * Copyright 2019 Ambrosus Inc.
 * Email: tech@ambrosus.com
 */

pragma solidity 0.5.3;

contract SidechannelStore {
    uint PRICE_PER_PERIOD_GAS = 1 * (10**9); //gwei
    uint BASE_PRICE_PER_PERIOD = 5.04576 * (10**13) * PRICE_PER_PERIOD_GAS; // estimate of 5.04576 * 10^13 gas per year for blocks of 8 mil. gas with 5 second blocktimes
    
    struct Sidechannel {
        uint chainId;
        address owner;
        uint expirationDate;
        uint paymentRemaining;
        string[] nodeUrls;
        address[] nodes;
        mapping (address => bool) onboardedNodes;
    }
    
    struct SidechainStatus {
        bytes32 blockHash;
        uint gasUsed;
        uint paidGas;
        mapping (address => uint) nodeRewards;
    }
    
    mapping (uint => Sidechannel) sidechannels;
    mapping (uint => SidechainStatus) sidechannelsStatus;
    uint currentChainId = 2; // start with 2, because 1 is the main chain
    
    function AddSidechannel(address owner, uint periods) public payable returns (uint) {
        uint chainId = currentChainId;
        uint expiration = now + (periods * 365 days);
        string[] memory nodeUrls;
        address[] memory nodes;
        Sidechannel memory channel = Sidechannel(chainId, owner, expiration, msg.value, nodeUrls, nodes);
        sidechannels[chainId] = channel;
        
        SidechainStatus memory status = SidechainStatus(0x0, 0, 0);
        sidechannelsStatus[chainId] = status;
        
        currentChainId += 1;
        return chainId;
    }
    
    function ExtendSidechannelPeriod(uint chainId, uint periods) public payable {
        sidechannels[chainId].expirationDate = sidechannels[chainId].expirationDate + (periods * 365 days);
        sidechannels[chainId].paymentRemaining = sidechannels[chainId].paymentRemaining + msg.value;
    }
    
    function OnboardNode(uint chainId, address node, string memory url) public {
        sidechannels[chainId].nodeUrls.push(url);
        sidechannels[chainId].nodes.push(node);
        sidechannels[chainId].onboardedNodes[node] = true;
    }
    
    function GetChainNodeUrl(uint chainId) public returns (string[] memory)  {
        return sidechannels[chainId].nodeUrls;
    }
    
    function GetOwner(uint chainId) public view returns (address) {
        return sidechannels[chainId].owner;
    }
    
    function IsOnboarded(address node, uint chainId) public returns (bool) {
        return sidechannels[chainId].onboardedNodes[node];
    }
    
    function CloseChain(uint chainId) public {
        uint refund = sidechannels[chainId].paymentRemaining;
        Sidechannel memory channel;
        sidechannels[chainId] = channel;
        msg.sender.transfer(refund);
    }
    
    function CommitStatus(uint chainId, address node, bytes32 hash, uint gasUsed) public { 
        sidechannelsStatus[chainId].blockHash = hash;
        sidechannelsStatus[chainId].gasUsed = sidechannelsStatus[chainId].gasUsed + gasUsed;
        for (uint i = 0; i < sidechannels[chainId].nodes.length; i++) {
            sidechannelsStatus[chainId].nodeRewards[sidechannels[chainId].nodes[i]] += gasUsed * PRICE_PER_PERIOD_GAS;
        }
    }
    
    function RetrievePayout(uint chainId, address node) public {
        uint reward = sidechannelsStatus[chainId].nodeRewards[node];
        sidechannels[chainId].paymentRemaining -= reward;
        sidechannelsStatus[chainId].paidGas += reward;
        sidechannelsStatus[chainId].nodeRewards[node] = 0;
        msg.sender.transfer(reward);
    }
    
    function GetUsedGas(uint chainId) public view returns (uint) {
        return sidechannelsStatus[chainId].gasUsed;
        
    }
    
    function GetTotalPaidAmount(uint chainId) public view returns (uint) {
        return sidechannelsStatus[chainId].paidGas;
    }
    
    function GetExpirationDate(uint chainId) public view returns (uint) {
        return sidechannels[chainId].expirationDate;
    }
}


contract SidechannelFront {
    uint PRICE_PER_PERIOD_GAS = 1 * (10**9); //gwei
    uint BASE_PRICE_PER_PERIOD = 5.04576 * (10**13) * PRICE_PER_PERIOD_GAS; // estimate of 5.04576 * 10^13 gas per year for blocks of 8 mil. gas with 5 second blocktimes
    
    SidechannelStore store;
    
    constructor(SidechannelStore _store) public {
        store = _store;
    }
    
    event SidechannelCreated(uint chainId, address owner);
    event SidechannelActive(uint chainId, string bootNodeUrl);
    event SidechannelStopped(uint chainId);
    
    modifier onlySidechannelOwner(uint chainId) {
        address owner = store.GetOwner(chainId);
        require(owner == msg.sender);
        _;
    }
    
    /**
     * @notice creates a side chian for a user
     * @dev terms sidechannel and sidechain may be used interchangably
     * @param owner - the owner of the new sidechain
     * @param periods - number of 1-year periods for the lifetime of the new sidechain
     * @return chain id of the new side chain
     */
    function CreateSidechannel(address owner, uint periods) public payable returns (uint) {
        require(correctPayment(0, periods, msg.value));
        uint chainId = store.AddSidechannel.value(msg.value)(owner, periods);
        return chainId;
    }
    
    /**
     * @notice extends the lifetime of the sidechannel
     * @dev only owner of the sidechannel may call this
     * @param chainId - id of the channel
     * @param periods - number of 1-year periods to add to the lifetime of the new sidechain
     */
    function ExtendSidechannel(uint chainId, uint periods) onlySidechannelOwner(chainId) public payable {
        require(chainActive(chainId));
        require(correctPayment(chainId, periods, msg.value));
        store.ExtendSidechannelPeriod.value(msg.value)(chainId, periods);
    }
    
    /**
     * @notice gets the url of the chain's bootnode
     * @param chainId - id of the channel
     * @return the url of a node connedcted to that sidechannel
     */
    function GetNodeUrl(uint chainId) public returns (string[] memory) {
        require(chainActive(chainId));
        return store.GetChainNodeUrl(chainId);
    }
    
    /**
     * @notice closes the sidechannel
     * @param chainId - id of the channel
     */ 
    function CloseSideChannel(uint chainId) onlySidechannelOwner(chainId) public {
        require(chainActive(chainId));
        store.CloseChain(chainId);
        msg.sender.transfer(address(this).balance);
    }
    
    /**
     * @notice adds node to the sidechannel
     * @param chainId - id of the channel
     * @param url - url of the node
     * @dev address of the node is msg.sender
     */
    function OnboardNode(uint chainId, string memory url) public {
        require(!store.IsOnboarded(msg.sender, chainId));
        require(!chainExpired(chainId));
        store.OnboardNode(chainId, msg.sender, url);
    }
    
    /**
     * @notice commit the status of the chain into main network
     * @param chainId - id of the channel
     * @param blocknum - block height of the sidechain
     * @param head - hash of the latest block on the sidechain
     * @dev address of the node is msg.sender
     */
    function CommitStatus(uint chainId, uint blocknum, bytes32 hash, uint gasUsed) public {
        require(store.IsOnboarded(msg.sender, chainId));
        require(chainActive(chainId));
        store.CommitStatus(chainId, msg.sender, hash, gasUsed);
    }
    
    /**
     * @notice pays fees to nodes for taking part in the sidechannel consensus
     * @param chainId - id of the channel
     * @dev address of the node is msg.sender
     */
    function WithdrawRewards(uint chainId) public {
        store.RetrievePayout(chainId, msg.sender);
        msg.sender.transfer(address(this).balance);
    }
    
    /**
     * @notice get the required payment to extend or to reserve a sidechain
     * @param periods amount of periods for reservation
     * @param chainId chain id of the existing channel if calculating payment for extending or 0 for new sidechannels 
     */
    function GetRequiredPayment(uint periods, uint chainId) public view returns (uint) {
        uint baseCost = BASE_PRICE_PER_PERIOD * periods; //use safe math
        if (chainId == 0) {
            return baseCost;
        }
        uint actualCost = store.GetUsedGas(chainId) * PRICE_PER_PERIOD_GAS; //use safe math
        uint paidCost = store.GetTotalPaidAmount(chainId);
        if (actualCost > paidCost) {
            return (actualCost - paidCost) + baseCost; //use safe math
        }
        return baseCost - (paidCost - actualCost); //use safe math
    }
    
    function chainActive(uint chainId) private returns (bool) {
        return !chainExpired(chainId) && store.GetChainNodeUrl(chainId).length > 0;
    }
    
    function chainExpired(uint chainId) private returns(bool) {
        return now > store.GetExpirationDate(chainId);
    }
    
    function correctPayment(uint chainId, uint periods, uint value) private returns (bool) {
        return GetRequiredPayment(periods, chainId) == value;
    }
}